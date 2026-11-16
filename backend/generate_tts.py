#!/usr/bin/env python3
"""Offline UzbekVoice TTS generator and audio review manifest builder.

Modes:
  --mode samples (default):
      Cleans up substituted voice duplicates (kamola/jasur -> sevinch), keeps the
      3x3=9 distinct UzbekVoice clips (shoira, lola, sevinch x n, na, ona), and
      generates 3 clearly named phonetic "nnn" experiment files:
      public/audio/voice_samples/experiment_nnn_<voice>.mp3.
      Updates audio_review.csv marking temporary edge-tts files as
      "temporary, not for distribution".

  --mode full --voice <voice>:
      Regenerates syllable/word/instruction clips using the chosen UzbekVoice model
      and updates audio_review.csv.

  --mode voicelab [--voice-id <id>]:
      Regenerates all 102 audio clips (sounds, instructions, UI phrases) using
      VoiceLab.uz REST API (default: Gulya — Sweet streamer) and updates
      audio_review.csv.
"""

import argparse
import asyncio
import csv
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

import requests

UZV_TTS_URL = os.environ.get("UZBEKVOICE_TTS_URL", "https://uzbekvoice.ai/api/v1/tts")
VOICELAB_TTS_URL = os.environ.get("VOICELAB_TTS_URL", "https://api.voicelab.uz/v1/tts")
SAFIYA_VOICE_ID = "voice_2785aabd-21b5-4cc7-9845-2230186ef7d9"
GULYA_VOICE_ID = "voice_7b350d91-4e56-4bc3-869c-8cd6ba646c3c"
VOICELAB_VOICE_NAMES = {
    GULYA_VOICE_ID: "gulya",
    SAFIYA_VOICE_ID: "safiya",
}
DISTINCT_VOICES = ["shoira", "lola", "sevinch"]

SAMPLE_ITEMS = [
    ("n", "n", "letter sound"),
    ("na", "na", "syllable"),
    ("ona", "ona", "word"),
]

# Full 48-lesson curriculum aligned with src/data/curriculum.ts
CURRICULUM_AUDIO = [
    # Stage 1: 7 lessons (A, O, I, U, E, OI, AU)
    ("a", "letter sound", "Aaaaa.", "Salom bolajon! Bu A harfi. Qizil unli harf, Aaaaa tovushi!"),
    ("o", "letter sound", "Ooooo.", "Zo‘r! Bu O harfi. Labingni doira qilib Ooooo deb ayt!"),
    ("i", "letter sound", "Iiiii.", "Tabassum qil! Bu I harfi, Iiiii tovushi!"),
    ("u", "letter sound", "Uuuuu.", "Ajoyib! Bu U harfi, Uuuuu deb cho‘zib aytamiz!"),
    ("e", "letter sound", "Eeeee.", "Yangi do‘stimiz — E harfi! Yengilgina Eeeee tovushi!"),
    ("oi", "syllable", "Oi.", "Endi unlilarni ulaymiz! O va I — Oi!"),
    ("au", "syllable", "Au.", "Barakalla! A va U ni birga aytamiz: Au!"),
    # Stage 2: 10 lessons (N, NA, NO, NI, M, MA, MO, L, LO, LA)
    ("n", "letter sound", "Nnnnn.", "Mana ko‘k undosh harf — N harfi! Nnnnn tovushi!"),
    ("na", "syllable", "Na.", "Nnnnn va Aaaaa qo‘shilsa — Na! Judayam oson!"),
    ("no", "syllable", "No.", "Endi N va O ni birlashtiramiz: No!"),
    ("ni", "syllable", "Ni.", "Barakalla! N va I qo‘shilsa — Ni bo‘ladi!"),
    ("m", "letter sound", "Mmmmm.", "Lablarni yumib aytamiz: M harfi, Mmmmm tovushi!"),
    ("ma", "syllable", "Ma.", "Mmmmm va Aaaaa — Ma! Qani, birga aytamiz!"),
    ("mo", "syllable", "Mo.", "Ajoyib! M va O birlashsa — Mo!"),
    ("l", "letter sound", "L tovushi.", "Bu esa quvnoq L harfi! L tovushi!"),
    ("lo", "syllable", "Lo.", "L va Ooooo qo‘shilsa — Lo!"),
    ("la", "syllable", "La.", "L va Aaaaa birga aytilsa — La!"),
    # Stage 3: 8 lessons (ONA, ANA, NON, NIMA, LOLA, OLMA, OILA, LIMON)
    ("ona", "word", "Ona.", "Birinchi so‘zimiz! O va na — Ona! Juda chiroyli so‘z!"),
    ("ana", "word", "Ana.", "A va na qo‘shilsa — Ana! Zo‘r o‘qiding!"),
    ("non", "word", "Non.", "No va n tovushi birlashsa — issiq Non!"),
    ("nima", "word", "Nima.", "Ni va ma bo‘g‘inlari qo‘shilsa — Nima so‘zi chiqadi!"),
    ("lola", "word", "Lola.", "Lo va la qo‘shilsa — chiroyli gul, Lola!"),
    ("olma", "word", "Olma.", "Ol va ma bo‘g‘inlari birga — shirin Olma!"),
    ("oila", "word", "Oila.", "Oi va la qo‘shilsa — ahil Oila!"),
    ("limon", "word", "Limon.", "Li va mon bo‘g‘inlarini ulaymiz — sariq Limon!"),
    # Stage 4: 10 lessons (S, SA, SI, R, RO, RA, ARRA, ASAL, V, SUV)
    ("s", "letter sound", "Sssss.", "Yangi ko‘k harfimiz — S! Mayin qilib Sssss deng!"),
    ("sa", "syllable", "Sa.", "Sssss va Aaaaa qo‘shilsa — Sa!"),
    ("si", "syllable", "Si.", "Sssss va Iiiii birga aytilsa — Si!"),
    ("r", "letter sound", "Rrrrr.", "Matorchadek jaranglaymiz: R harfi, Rrrrr tovushi!"),
    ("ro", "syllable", "Ro.", "Rrrrr va Ooooo qo‘shilsa — Ro!"),
    ("ra", "syllable", "Ra.", "Rrrrr va Aaaaa birlashsa — Ra!"),
    ("arra", "word", "Arra.", "Ar va ra bo‘g‘inlari qo‘shilsa — Arra!"),
    ("asal", "word", "Asal.", "A va sal bo‘laklarini o‘qiymiz — shirin Asal!"),
    ("v", "letter sound", "Vvvvv.", "Shamoldek esamiz: V harfi, Vvvvv tovushi!"),
    ("suv", "word", "Suv.", "Su va v qo‘shilsa — tiniq Suv!"),
    # Stage 5: 13 lessons (B, BA, BO, BOLA, BOBO, T, TA, OTA, D, DA, DADA, K, KITOB)
    ("b", "letter sound", "B!", "Qahramonlar qal’asi! Bu B harfi, chaqqon B tovushi!"),
    ("ba", "syllable", "Ba.", "B va A birlashsa — Ba!"),
    ("bo", "syllable", "Bo.", "B va O qo‘shilsa — Bo!"),
    ("bola", "word", "Bola.", "Bo va la qo‘shilsa — aqlli Bola!"),
    ("bobo", "word", "Bobo.", "Ikkita Bo bo‘g‘ini — mehribon Bobo!"),
    ("t", "letter sound", "T!", "Yana bir chaqqon harf — T harfi, qisqa T tovushi!"),
    ("ta", "syllable", "Ta.", "T va A birga o‘qilsa — Ta!"),
    ("ota", "word", "Ota.", "O va ta bo‘laklari qo‘shilsa — Ota!"),
    ("d", "letter sound", "D!", "Bu esa kuchli D harfi, qisqa D tovushi!"),
    ("da", "syllable", "Da.", "D va A qo‘shilsa — Da!"),
    ("dada", "word", "Dada.", "Da va da birlashsa — aziz Dada!"),
    ("k", "letter sound", "K!", "So‘nggi kalit harfimiz — K! Chaqqon K tovushi!"),
    ("kitob", "word", "Kitob.", "Ki va tob qo‘shilsa — bilim manbai Kitob! Barakalla!"),
]

UI_PHRASES = [
    ("barakalla", "instruction", "Barakalla bolajon! Juda chiroyli va to‘g‘ri o‘qiding!"),
    ("qayta_urinib_koring", "instruction", "Hechqisi yo‘q! Keling, yana bir marta birga urinib ko‘ramiz!"),
    ("qaysi_biri", "instruction", "Diqqat bilan quloq sol va to‘g‘ri kartani bos!"),
    ("ulab_oqiymiz", "instruction", "Endi vagonchalarni birlashtirib, harflarni ulab o‘qi!"),
    ("mikrofonga_ayting", "instruction", "Mikrofon tugmasini bosib, baland ovozda o‘qib ber!"),
    ("jimlik_sezildi", "instruction", "Ovozing yaxshi eshitilmadi, mikrofon yonida balandroq ayt!"),
]


def load_env_secret(project_root: Path, var_name: str) -> str:
    """Load secret from environment or project .env (never prints secret)."""
    key = os.environ.get(var_name, "").strip()
    if key:
        return key
    env_file = project_root / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            k, v = stripped.split("=", 1)
            if k.strip() == var_name:
                return v.strip().strip('"').strip("'")
    sys.exit(f"{var_name} topilmadi. Muhit o'zgaruvchisi yoki .env faylini tekshiring.")


def load_api_key(project_root: Path) -> str:
    """Load UZBEKVOICE_API_KEY from environment or project .env (never prints key)."""
    return load_env_secret(project_root, "UZBEKVOICE_API_KEY")


def load_voicelab_api_key(project_root: Path) -> str:
    """Load VOICELAB_API_KEY from environment or project .env (never prints key)."""
    return load_env_secret(project_root, "VOICELAB_API_KEY")


def find_ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def wav_bytes_to_mp3(audio_bytes: bytes, out_path: Path, ffmpeg_exe: str) -> None:
    """Convert WAV/audio bytes from UzbekVoice CDN to clean 44.1 kHz mono MP3."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [ffmpeg_exe, "-y", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", "44100", "-b:a", "128k", str(out_path)],
        input=audio_bytes,
        capture_output=True,
        check=True,
    )


def synthesize_uzbekvoice(api_key: str, text: str, model: str, out_path: Path, ffmpeg_exe: str) -> dict:
    """Call POST https://uzbekvoice.ai/api/v1/tts without deprecated mood parameter."""
    resp = requests.post(
        UZV_TTS_URL,
        headers={"Authorization": api_key},
        json={"text": text, "model": model, "blocking": "true"},
        timeout=45,
    )
    if resp.status_code >= 400:
        return {
            "ok": False,
            "http_status": resp.status_code,
            "error": resp.text[:300],
        }

    body = resp.json()
    task_id = body.get("id")
    deadline = time.time() + 30
    while not (body.get("result") or {}).get("url") and time.time() < deadline:
        time.sleep(0.5)
        poll = requests.get(
            "https://uzbekvoice.ai/api/v1/tasks",
            params={"id": task_id},
            headers={"Authorization": api_key},
            timeout=30,
        )
        poll.raise_for_status()
        body = poll.json()

    audio_url = (body.get("result") or {}).get("url")
    if not audio_url:
        return {"ok": False, "http_status": resp.status_code, "error": "No result.url returned"}

    media = requests.get(audio_url, timeout=45)
    media.raise_for_status()
    wav_bytes_to_mp3(media.content, out_path, ffmpeg_exe)

    return {
        "ok": True,
        "http_status": resp.status_code,
        "requested_model": body.get("requested_model"),
        "actual_model": body.get("model"),
        "model_substituted": body.get("model_substituted"),
        "bytes": out_path.stat().st_size,
    }


def _parse_int_header(headers: requests.structures.CaseInsensitiveDict, name: str) -> int | None:
    raw = headers.get(name)
    if raw is None:
        return None
    try:
        return int(float(raw))
    except ValueError:
        return None


def synthesize_voicelab(api_key: str, text: str, voice_id: str, out_path: Path, ffmpeg_exe: str) -> dict:
    """Call POST https://api.voicelab.uz/v1/tts and convert returned WAV bytes to MP3."""
    for attempt in range(4):
        resp = requests.post(
            VOICELAB_TTS_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": str(uuid.uuid4()),
                "Accept": "audio/wav",
            },
            json={"text": text, "language": "uz", "voice_id": voice_id},
            timeout=60,
        )
        if resp.status_code == 429 and attempt < 3:
            reset_s = _parse_int_header(resp.headers, "Retry-After")
            if reset_s is None:
                reset_s = _parse_int_header(resp.headers, "Ratelimit-Reset")
            wait_s = max(1, (reset_s if reset_s is not None else 2) + 1)
            time.sleep(wait_s)
            continue

        if resp.status_code >= 400:
            return {
                "ok": False,
                "http_status": resp.status_code,
                "error": resp.text[:300],
            }

        wav_bytes_to_mp3(resp.content, out_path, ffmpeg_exe)
        return {
            "ok": True,
            "http_status": resp.status_code,
            "bytes": out_path.stat().st_size,
            "duration_ms": resp.headers.get("X-Voicelab-Audio-Duration-Ms"),
            "credits_used": resp.headers.get("X-Voicelab-Credits-Used"),
            "ratelimit_remaining": _parse_int_header(resp.headers, "Ratelimit-Remaining"),
            "ratelimit_reset": _parse_int_header(resp.headers, "Ratelimit-Reset"),
        }

    return {"ok": False, "http_status": 429, "error": "Rate limit retries exhausted"}


async def ensure_missing_placeholders(audio_dir: Path) -> list[str]:
    import edge_tts

    created: list[str] = []
    for item_id, _kind, short_sound, teacher_prompt in CURRICULUM_AUDIO:
        for fname, text in [(f"item_{item_id}.mp3", teacher_prompt), (f"sound_{item_id}.mp3", short_sound)]:
            out_path = audio_dir / fname
            if not out_path.exists():
                comm = edge_tts.Communicate(text, "uz-UZ-MadinaNeural", rate="-12%")
                await comm.save(str(out_path))
                created.append(fname)
    return created


def write_review_csv(
    project_root: Path,
    sample_rows: list[dict],
    active_voice: str | None = None,
    provider: str = "uzbekvoice",
    file_voice_map: dict[str, str] | None = None,
) -> Path:
    """Write audio_review.csv tracking voice attribution and review status for every static file."""
    rows = []
    for item_id, kind, short_sound, teacher_prompt in CURRICULUM_AUDIO:
        sound_fname = f"sound_{item_id}.mp3"
        item_fname = f"item_{item_id}.mp3"
        if file_voice_map is not None:
            fallback_tag = f"{provider}:{active_voice or 'gulya'}"
            rows.append({
                "file": f"public/audio/{sound_fname}",
                "text": short_sound,
                "type": kind,
                "voice": file_voice_map.get(sound_fname, fallback_tag),
                "status": "needs teacher review",
            })
            rows.append({
                "file": f"public/audio/{item_fname}",
                "text": teacher_prompt,
                "type": "instruction",
                "voice": file_voice_map.get(item_fname, fallback_tag),
                "status": "needs teacher review",
            })
        elif active_voice and provider == "voicelab":
            voice_tag = f"voicelab:{active_voice}"
            rows.append({
                "file": f"public/audio/{sound_fname}",
                "text": short_sound,
                "type": kind,
                "voice": voice_tag,
                "status": "needs teacher review",
            })
            rows.append({
                "file": f"public/audio/{item_fname}",
                "text": teacher_prompt,
                "type": "instruction",
                "voice": voice_tag,
                "status": "needs teacher review",
            })
        elif active_voice:
            rows.append({
                "file": f"public/audio/{sound_fname}",
                "text": short_sound,
                "type": kind,
                "voice": "human-recorded-required" if kind == "letter sound" else f"uzbekvoice:{active_voice}",
                "status": "temporary, not for distribution" if kind == "letter sound" else "needs teacher review",
            })
            rows.append({
                "file": f"public/audio/{item_fname}",
                "text": teacher_prompt,
                "type": "instruction",
                "voice": f"uzbekvoice:{active_voice}",
                "status": "needs teacher review",
            })
        else:
            rows.append({
                "file": f"public/audio/{sound_fname}",
                "text": short_sound,
                "type": kind,
                "voice": "temporary:edge-tts:uz-UZ-MadinaNeural",
                "status": "temporary, not for distribution",
            })
            rows.append({
                "file": f"public/audio/{item_fname}",
                "text": teacher_prompt,
                "type": "instruction",
                "voice": "temporary:edge-tts:uz-UZ-MadinaNeural",
                "status": "temporary, not for distribution",
            })

    for key, kind, phrase in UI_PHRASES:
        ui_fname = f"{key}.mp3"
        if file_voice_map is not None:
            voice_tag = file_voice_map.get(ui_fname, f"{provider}:{active_voice or 'gulya'}")
            status = "needs teacher review"
        elif active_voice:
            voice_tag = f"{provider}:{active_voice}"
            status = "needs teacher review"
        else:
            voice_tag = "temporary:edge-tts:uz-UZ-MadinaNeural"
            status = "temporary, not for distribution"

        rows.append({
            "file": f"public/audio/{ui_fname}",
            "text": phrase,
            "type": kind,
            "voice": voice_tag,
            "status": status,
        })

    rows.extend(sample_rows)

    csv_path = project_root / "audio_review.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["file", "text", "type", "voice", "status"])
        writer.writeheader()
        writer.writerows(rows)
    return csv_path


def run_samples(project_root: Path, api_key: str) -> None:
    audio_dir = project_root / "public" / "audio"
    samples_dir = audio_dir / "voice_samples"
    samples_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg_exe = find_ffmpeg()

    # Remove kamola/jasur duplicates substituted by UzbekVoice API with sevinch
    for dup_prefix in ("kamola_", "jasur_"):
        for f in samples_dir.glob(f"{dup_prefix}*.mp3"):
            f.unlink()
            print(f"Removed substituted duplicate: {f.name}")

    asyncio.run(ensure_missing_placeholders(audio_dir))

    sample_rows = []
    # Keep/verify 3x3=9 files + generate 3 clearly named "nnn" phonetic experiment clips
    for voice in DISTINCT_VOICES:
        for item_id, text, item_type in SAMPLE_ITEMS:
            out_path = samples_dir / f"{voice}_{item_id}.mp3"
            if not out_path.exists():
                synthesize_uzbekvoice(api_key, text, voice, out_path, ffmpeg_exe)
                time.sleep(0.2)
            sample_rows.append({
                "file": f"public/audio/voice_samples/{voice}_{item_id}.mp3",
                "text": text,
                "type": item_type,
                "voice": f"uzbekvoice:{voice}",
                "status": "needs teacher review",
            })

        exp_path = samples_dir / f"experiment_nnn_{voice}.mp3"
        res = synthesize_uzbekvoice(api_key, "nnn", voice, exp_path, ffmpeg_exe)
        if res["ok"]:
            print(
                f"  OK   experiment_nnn_{voice}.mp3 ('nnn') -> "
                f"actual_model={res['actual_model']} substituted={res['model_substituted']} ({res['bytes']} B)"
            )
            sample_rows.append({
                "file": f"public/audio/voice_samples/experiment_nnn_{voice}.mp3",
                "text": "nnn",
                "type": "phonetic experiment",
                "voice": f"uzbekvoice:{res['actual_model']}",
                "status": "needs teacher review",
            })
        else:
            print(f"  FAIL experiment_nnn_{voice}.mp3 -> HTTP {res['http_status']}: {res['error']}")
        time.sleep(0.25)

    csv_path = write_review_csv(project_root, sample_rows)
    print(f"\nReview manifest updated: {csv_path}")


def run_full(project_root: Path, api_key: str, voice: str) -> None:
    if voice not in DISTINCT_VOICES:
        sys.exit(f"Noto'g'ri model '{voice}'. Mavjud ovozlar: {', '.join(DISTINCT_VOICES)}")
    audio_dir = project_root / "public" / "audio"
    ffmpeg_exe = find_ffmpeg()

    for item_id, kind, short_sound, teacher_prompt in CURRICULUM_AUDIO:
        if kind != "letter sound":
            res = synthesize_uzbekvoice(api_key, short_sound, voice, audio_dir / f"sound_{item_id}.mp3", ffmpeg_exe)
            print(f"  sound_{item_id}.mp3 -> {'OK' if res['ok'] else res.get('error')}")
            time.sleep(0.2)
        res_t = synthesize_uzbekvoice(api_key, teacher_prompt, voice, audio_dir / f"item_{item_id}.mp3", ffmpeg_exe)
        print(f"  item_{item_id}.mp3  -> {'OK' if res_t['ok'] else res_t.get('error')}")
        time.sleep(0.2)

    for key, _kind, phrase in UI_PHRASES:
        res = synthesize_uzbekvoice(api_key, phrase, voice, audio_dir / f"{key}.mp3", ffmpeg_exe)
        print(f"  {key}.mp3 -> {'OK' if res['ok'] else res.get('error')}")
        time.sleep(0.2)

    csv_path = write_review_csv(project_root, [], active_voice=voice)
    print(f"Full regeneration done with '{voice}'. Manifest: {csv_path}")


def run_voicelab_full(project_root: Path, api_key: str, voice_id: str) -> None:
    """Regenerate all 102 static MP3 clips using VoiceLab.uz with local cache and adaptive pacing."""
    audio_dir = project_root / "public" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    cache_path = audio_dir / ".voicelab_cache.json"
    ffmpeg_exe = find_ffmpeg()

    cache: dict[str, dict[str, str]] = {}
    if cache_path.exists():
        try:
            loaded = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                cache = loaded
        except Exception:
            cache = {}

    tasks: list[tuple[str, str]] = []
    for item_id, _kind, short_sound, teacher_prompt in CURRICULUM_AUDIO:
        tasks.append((f"sound_{item_id}.mp3", short_sound))
        tasks.append((f"item_{item_id}.mp3", teacher_prompt))
    for key, _kind, phrase in UI_PHRASES:
        tasks.append((f"{key}.mp3", phrase))

    total = len(tasks)
    voice_label = VOICELAB_VOICE_NAMES.get(voice_id, voice_id)
    print(f"Synthesizing {total} files with VoiceLab voice={voice_label} ({voice_id}) ...", flush=True)
    synthesized = 0
    skipped = 0
    kept_safiya = 0
    fallback_lola = 0
    credits_exhausted = False
    uzv_key: str | None = None
    file_voice_map: dict[str, str] = {}

    for idx, (fname, text) in enumerate(tasks, start=1):
        out_path = audio_dir / fname
        cached_entry = cache.get(fname)
        if out_path.exists() and cached_entry == {"voice_id": voice_id, "text": text}:
            skipped += 1
            file_voice_map[fname] = f"voicelab:{voice_label}"
            print(f"  [{idx:03d}/{total}] {fname:<26} CACHED ({voice_label})", flush=True)
            continue

        if not credits_exhausted:
            res = synthesize_voicelab(api_key, text, voice_id, out_path, ffmpeg_exe)
            if res["ok"]:
                synthesized += 1
                file_voice_map[fname] = f"voicelab:{voice_label}"
                cache[fname] = {"voice_id": voice_id, "text": text}
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")

                remaining = res.get("ratelimit_remaining")
                reset_s = res.get("ratelimit_reset")
                print(
                    f"  [{idx:03d}/{total}] {fname:<26} OK ({res['bytes']} B, {res.get('duration_ms')} ms, rem={remaining})",
                    flush=True,
                )

                if idx < total:
                    if remaining is not None and remaining <= 2:
                        wait_s = max(1, (reset_s if reset_s is not None else 2) + 1)
                        time.sleep(wait_s)
                    else:
                        time.sleep(0.35)
                continue

            if res.get("http_status") == 402:
                credits_exhausted = True
                print(
                    f"  [WARN] VoiceLab credits exhausted (HTTP 402) at {idx}/{total} ({fname}). "
                    "Keeping existing Safiya clips and using UzbekVoice Lola for missing files.",
                    flush=True,
                )
            else:
                sys.exit(
                    f"VoiceLab synthesis failed at {idx}/{total} ({fname}): "
                    f"HTTP {res.get('http_status')}: {res.get('error')}"
                )

        # Fallback path after HTTP 402
        if out_path.exists():
            kept_safiya += 1
            file_voice_map[fname] = "voicelab:safiya"
            print(f"  [{idx:03d}/{total}] {fname:<26} KEPT existing Safiya", flush=True)
        else:
            if uzv_key is None:
                uzv_key = load_api_key(project_root)
            res_u = synthesize_uzbekvoice(uzv_key, text, "lola", out_path, ffmpeg_exe)
            if not res_u["ok"]:
                sys.exit(
                    f"UzbekVoice Lola fallback failed at {idx}/{total} ({fname}): "
                    f"HTTP {res_u.get('http_status')}: {res_u.get('error')}"
                )
            fallback_lola += 1
            file_voice_map[fname] = "uzbekvoice:lola"
            print(f"  [{idx:03d}/{total}] {fname:<26} FALLBACK uzbekvoice:lola ({res_u['bytes']} B)", flush=True)
            time.sleep(0.2)

    csv_path = write_review_csv(
        project_root,
        [],
        active_voice=voice_label,
        provider="voicelab",
        file_voice_map=file_voice_map,
    )
    print(
        f"Sync complete (gulya_new={synthesized}, gulya_cached={skipped}, kept_safiya={kept_safiya}, fallback_lola={fallback_lola}). "
        f"Manifest updated: {csv_path}",
        flush=True,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate static TTS audio & review CSV")
    ap.add_argument("--mode", choices=["samples", "full", "voicelab"], default="samples")
    ap.add_argument("--voice", default="shoira", help="Voice model for --mode full")
    ap.add_argument(
        "--voice-id",
        default=os.environ.get("VOICELAB_VOICE_ID", GULYA_VOICE_ID),
        help="VoiceLab voice ID for --mode voicelab",
    )
    args = ap.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    if args.mode == "voicelab":
        vl_key = load_voicelab_api_key(project_root)
        run_voicelab_full(project_root, vl_key, args.voice_id)
    elif args.mode == "samples":
        uzv_key = load_api_key(project_root)
        run_samples(project_root, uzv_key)
    else:
        uzv_key = load_api_key(project_root)
        run_full(project_root, uzv_key, args.voice)


if __name__ == "__main__":
    main()
