#!/usr/bin/env python3
"""Local Alifbo Voice AI server (aiohttp on 127.0.0.1:8765).

Privacy guarantees enforced by design:
- Child audio bytes received in POST /api/stt are decoded strictly in memory
  (io.BytesIO / subprocess stdin pipe) and never written to disk.
- No child audio, transcript, or normalized recognition output is ever logged
  or persisted by this server.
- /api/tts proxies Zukko Tulki speech strictly to VoiceLab Lison v2 using server-side .env credentials.
"""

import asyncio
import base64
import hashlib
import io
import math
import os
import re
import shutil
import subprocess
import time
import uuid
import wave
from pathlib import Path
from urllib.parse import urljoin

import aiohttp
import numpy as np
import onnx_asr
from aiohttp import web

PORT = int(os.environ.get("PORT") or os.environ.get("ALIFBO_PORT") or "8765")
HOST = os.environ.get("ALIFBO_HOST") or ("0.0.0.0" if os.environ.get("PORT") else "127.0.0.1")
STT_MODEL_ID = (
    os.environ.get("STT_MODEL_ID", "OpenVoiceOS/asr-uz-fastconformer-large-onnx").strip()
    or "OpenVoiceOS/asr-uz-fastconformer-large-onnx"
)
SAMPLE_RATE = 16_000
SILENCE_RMS_FLOOR = 0.008

DEFAULT_VOICELAB_TTS_URL = "https://api.voicelab.uz/v1/tts"
DEFAULT_VOICELAB_MODEL_ID = "lison-v2"
DEFAULT_VOICELAB_VOICE_ID = "voice_83a39d68-22bc-4062-b86e-0a9dd998ba7a"
NEUTRAL_VOICELAB_VOICE_ID = DEFAULT_VOICELAB_VOICE_ID


def load_dotenv_file(env_path: Path) -> dict[str, str]:
    """Read key=value pairs from .env without printing secrets."""
    parsed: dict[str, str] = {}
    if not env_path.exists():
        return parsed
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        k, v = stripped.split("=", 1)
        parsed[k.strip()] = v.strip().strip('"').strip("'")
    return parsed


def get_voicelab_config(project_root: Path) -> dict[str, str]:
    """Resolve VoiceLab credentials and locked Lison v2 Malika defaults from env or .env."""
    file_env = load_dotenv_file(project_root / ".env")
    return {
        "api_key": (os.environ.get("VOICELAB_API_KEY") or file_env.get("VOICELAB_API_KEY", "")).strip(),
        "tts_url": (os.environ.get("VOICELAB_TTS_URL") or file_env.get("VOICELAB_TTS_URL") or DEFAULT_VOICELAB_TTS_URL).strip(),
        "model_id": DEFAULT_VOICELAB_MODEL_ID,
        "voice_id": DEFAULT_VOICELAB_VOICE_ID,
        "neutral_voice_id": NEUTRAL_VOICELAB_VOICE_ID,
    }

APOSTROPHES = str.maketrans(
    {"\u2018": "'", "\u2019": "'", "\u02bb": "'", "\u02bc": "'", "`": "'", "\u00b4": "'"}
)


def normalize_uzbek(text: str) -> str:
    """Lowercase, unify Uzbek apostrophes, strip punctuation, and collapse whitespace."""
    cleaned = (text or "").translate(APOSTROPHES).lower()
    cleaned = re.sub(r"[^\w\s']", " ", cleaned, flags=re.UNICODE).replace("_", " ")
    return re.sub(r"\s+", " ", cleaned).strip()


def trim_silence(
    wav: np.ndarray,
    sample_rate: int = SAMPLE_RATE,
    frame_ms: int = 20,
    pad_ms: int = 220,
) -> tuple[np.ndarray, bool, dict]:
    """Strip leading/trailing silence and detect pure-silence clips via RMS floor."""
    hop = int(sample_rate * frame_ms / 1000)
    n_frames = len(wav) // hop
    orig_ms = round(len(wav) / sample_rate * 1000)
    if n_frames == 0:
        return np.zeros(0, dtype=np.float32), False, {"orig_ms": orig_ms, "trimmed_ms": 0, "rms_max": 0.0}

    frames = wav[: n_frames * hop].reshape(n_frames, hop)
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    rms_max = float(np.max(rms))
    if rms_max < SILENCE_RMS_FLOOR:
        return np.zeros(0, dtype=np.float32), False, {
            "orig_ms": orig_ms,
            "trimmed_ms": 0,
            "rms_max": round(rms_max, 5),
        }

    thresh = max(0.008, rms_max * 0.06)
    active = np.flatnonzero(rms >= thresh)
    if len(active) == 0:
        return np.zeros(0, dtype=np.float32), False, {
            "orig_ms": orig_ms,
            "trimmed_ms": 0,
            "rms_max": round(rms_max, 5),
        }

    pad_samples = int(sample_rate * pad_ms / 1000)
    start = max(0, int(active[0]) * hop - pad_samples)
    end = min(len(wav), int(active[-1] + 1) * hop + pad_samples)
    trimmed = wav[start:end]
    return trimmed, True, {
        "orig_ms": orig_ms,
        "trimmed_ms": round(len(trimmed) / sample_rate * 1000),
        "rms_max": round(rms_max, 5),
    }


def _find_ffmpeg() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def decode_audio_to_float32(raw_bytes: bytes) -> np.ndarray:
    """Decode 16 kHz mono WAV in memory, or convert via ffmpeg stdin/stdout pipes."""
    if raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WAVE":
        try:
            with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
                if wf.getnchannels() == 1 and wf.getframerate() == SAMPLE_RATE and wf.getsampwidth() == 2:
                    pcm = wf.readframes(wf.getnframes())
                    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        except wave.Error:
            pass

    exe = _find_ffmpeg()
    if not exe:
        raise ValueError("Audio 16 kHz mono PCM16 WAV bo'lishi kerak (yoki ffmpeg topilmadi)")
    proc = subprocess.run(
        [exe, "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1"],
        input=raw_bytes,
        capture_output=True,
        check=True,
    )
    return np.frombuffer(proc.stdout, dtype="<i2").astype(np.float32) / 32768.0


def _build_accepted_set(expected: str, accept_raw: str) -> set[str]:
    accepted_set = {normalize_uzbek(expected)} if expected.strip() else set()
    for part in (accept_raw or "").split("|"):
        norm_part = normalize_uzbek(part)
        if norm_part:
            accepted_set.add(norm_part)
    return accepted_set


def evaluate_match(expected: str, accept_raw: str, transcript: str, is_silence: bool) -> bool:
    if is_silence or not transcript.strip():
        return False
    accepted_set = _build_accepted_set(expected, accept_raw)
    norm_tr = normalize_uzbek(transcript)
    return norm_tr in accepted_set


def _rnnt_decode_penalized(asr, enc_out_1: np.ndarray, enc_len: int, blank_penalty: float = 0.0) -> str:
    state = asr._create_state()
    tokens: list[int] = []
    for t in range(int(enc_len)):
        step_tokens = 0
        while step_tokens < 4:
            logits, _, next_state = asr._decode(tokens, state, enc_out_1[t])
            if blank_penalty > 0.0:
                logits = logits.copy()
                logits[asr._blank_idx] -= blank_penalty
            tok_id = int(np.argmax(logits))
            if tok_id == asr._blank_idx:
                break
            tokens.append(tok_id)
            state = next_state
            step_tokens += 1
    text = "".join(asr._vocab.get(i, "") for i in tokens).replace("\u2581", " ").strip()
    return normalize_uzbek(text)


def _extract_top_frame_tokens(asr, enc_out_1: np.ndarray, enc_len: int, top_k: int = 6) -> list[str]:
    state = asr._create_state()
    vocab_size = len(asr._vocab)
    max_logits = np.full(vocab_size, -1e9, dtype=np.float32)
    for t in range(int(enc_len)):
        logits, _, _ = asr._decode([], state, enc_out_1[t])
        logits = logits.copy()
        logits[asr._blank_idx] = -1e9
        max_logits = np.maximum(max_logits, logits[:vocab_size])
    sorted_idx = np.argsort(-max_logits)[: top_k * 4]
    out: list[str] = []
    for idx in sorted_idx:
        if max_logits[idx] <= -1000.0:
            break
        tok = normalize_uzbek(asr._vocab.get(int(idx), "").replace("\u2581", ""))
        if tok and tok not in out:
            out.append(tok)
            if len(out) >= top_k:
                break
    return out


def recognize_utterance(
    app: web.Application, trimmed: np.ndarray, expected: str, accept_raw: str
) -> tuple[str, float | None, bool]:
    """Run in-memory multi-pass FastConformer RNNT recognition for words and short sounds."""
    ts_adapter = app["ts_adapter"]
    accepted_set = _build_accepted_set(expected, accept_raw)

    res = ts_adapter.recognize(trimmed, sample_rate=SAMPLE_RATE)
    raw_tr = (res.text or "").strip()
    probs = [math.exp(lp) for lp in (res.logprobs or [])]
    raw_confidence: float | None = round(float(sum(probs) / len(probs)), 3) if probs else None
    confidence_available = raw_confidence is not None

    candidates: list[str] = []
    if raw_tr:
        candidates.append(raw_tr)

    asr = ts_adapter.asr
    peak = float(np.max(np.abs(trimmed))) if len(trimmed) else 0.0
    norm_wav = (trimmed / peak) * 0.8 if peak > 0.01 else trimmed

    def _run_padded_decode(pad_sec: float) -> tuple[str, str, str, list[str]]:
        pad = np.zeros(int(SAMPLE_RATE * pad_sec), dtype=np.float32)
        padded = np.concatenate([pad, norm_wav, pad]).astype(np.float32)
        feats, feat_lens = asr._preprocessor(padded[None, :], np.array([len(padded)], dtype=np.int64))
        enc_out, enc_lens = asr._encode(feats, feat_lens)
        enc_1 = enc_out[0]
        enc_len = int(enc_lens[0])
        return (
            _rnnt_decode_penalized(asr, enc_1, enc_len, 0.0),
            _rnnt_decode_penalized(asr, enc_1, enc_len, 2.5),
            _rnnt_decode_penalized(asr, enc_1, enc_len, 4.0),
            _extract_top_frame_tokens(asr, enc_1, enc_len, top_k=6),
        )

    p0, p25, p40, top_tokens = _run_padded_decode(0.45)

    for c in (p0, p25, p40):
        if c:
            candidates.append(c)

    if not raw_tr and not p0 and not p25 and not p40 and not top_tokens:
        p0, p25, p40, top_tokens = _run_padded_decode(0.10)
        for c in (p0, p25, p40):
            if c:
                candidates.append(c)

    zcr = float(np.mean(np.abs(np.diff(np.signbit(trimmed))))) if len(trimmed) > 1 else 0.0
    dur_ms = (len(trimmed) / SAMPLE_RATE) * 1000.0
    if zcr >= 0.32 and "s" in accepted_set:
        candidates.append("s")
    if 0.03 <= zcr <= 0.065 and dur_ms >= 400.0 and "n" in accepted_set:
        if any(tok in {"e", "h", "i", "u", "n"} for tok in top_tokens):
            candidates.append("n")

    candidates.extend(top_tokens)

    for cand in candidates:
        norm_cand = normalize_uzbek(cand)
        if norm_cand and norm_cand in accepted_set:
            return cand, raw_confidence, confidence_available

    for fallback in (raw_tr, p0, p25, p40, *(top_tokens[:1])):
        if fallback and fallback.strip():
            return fallback.strip(), raw_confidence, confidence_available
    return "", raw_confidence, confidence_available


@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        resp = await handler(request)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Expected, X-Accept"
    return resp


async def handle_health(request: web.Request) -> web.Response:
    if not request.app.get("model_ready") or request.app.get("ts_adapter") is None:
        return web.json_response(
            {
                "ok": False,
                "status": "loading",
                "model": "uzinfocom-rnnt",
                "model_id": STT_MODEL_ID,
            },
            status=503,
        )
    cfg = request.app["voicelab_config"]
    return web.json_response(
        {
            "ok": True,
            "model": "uzinfocom-rnnt",
            "model_id": STT_MODEL_ID,
            "status": "ready",
            "tts_ready": bool(cfg.get("api_key")),
            "tts_provider": "voicelab",
            "tts_model": cfg.get("model_id", DEFAULT_VOICELAB_MODEL_ID),
            "tts_voice": cfg.get("voice_id", DEFAULT_VOICELAB_VOICE_ID),
        }
    )


async def handle_stt(request: web.Request) -> web.Response:
    """In-memory speech recognition endpoint; zero disk writes, zero transcript logging."""
    expected = request.query.get("expected") or request.headers.get("X-Expected", "")
    accept_raw = request.query.get("accept") or request.headers.get("X-Accept", "")

    content_type = request.content_type or ""
    if "application/json" in content_type:
        payload = await request.json()
        expected = payload.get("expected", expected)
        accept_raw = payload.get("accept", accept_raw)
        audio_b64 = payload.get("audio_base64", "")
        raw_bytes = base64.b64decode(audio_b64)
    elif "multipart/form-data" in content_type:
        reader = await request.multipart()
        raw_bytes = b""
        async for part in reader:
            if part.name == "file":
                raw_bytes = await part.read()
            elif part.name == "expected":
                expected = (await part.read()).decode("utf-8")
            elif part.name == "accept":
                accept_raw = (await part.read()).decode("utf-8")
    else:
        raw_bytes = await request.read()

    if not raw_bytes:
        return web.json_response({"ok": False, "error": "Bo'sh audio yuborildi"}, status=400)

    try:
        wav = decode_audio_to_float32(raw_bytes)
    except Exception as exc:
        return web.json_response({"ok": False, "error": f"Audio o'qilmadi: {exc}"}, status=400)

    trimmed, has_speech, info = trim_silence(wav)
    t0 = time.perf_counter()

    if not has_speech or len(trimmed) < 800:
        return web.json_response(
            {
                "ok": True,
                "transcript": "",
                "normalized": "",
                "accepted": False,
                "is_silence": True,
                "confidence": 0.0,
                "confidence_available": True,
                "latency_ms": 0,
                "orig_ms": info["orig_ms"],
                "trimmed_ms": info["trimmed_ms"],
            }
        )

    lock: asyncio.Lock = request.app["stt_lock"]
    async with lock:
        transcript, confidence, confidence_available = await asyncio.to_thread(
            recognize_utterance, request.app, trimmed, expected, accept_raw
        )

    latency_ms = round((time.perf_counter() - t0) * 1000)
    is_silence = False
    accepted = evaluate_match(expected, accept_raw, transcript, is_silence)

    return web.json_response(
        {
            "ok": True,
            "transcript": transcript,
            "normalized": normalize_uzbek(transcript),
            "accepted": accepted,
            "is_silence": is_silence,
            "confidence": confidence,
            "confidence_available": confidence_available,
            "latency_ms": latency_ms,
            "orig_ms": info["orig_ms"],
            "trimmed_ms": info["trimmed_ms"],
        }
    )


def _parse_wait_seconds(headers: object, default: float = 2.0) -> float:
    for key in ("Retry-After", "Ratelimit-Reset"):
        raw = headers.get(key) if hasattr(headers, "get") else None
        if raw is not None:
            try:
                return max(1.0, float(raw) + 0.5)
            except (TypeError, ValueError):
                pass
    return default


class VoiceLabCreditsExhaustedError(RuntimeError):
    """Raised when VoiceLab API returns HTTP 402 (credits exhausted)."""


def _detect_audio_mime(audio_bytes: bytes) -> str:
    if audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE":
        return "audio/wav"
    if audio_bytes[:4] == b"OggS":
        return "audio/ogg"
    return "audio/mpeg"


def _prepare_voicelab_tts_text(text: str) -> str:
    """Prevent VoiceLab G2P rounding of habit words and letter F."""
    text = re.sub(
        r"\bbismill[ao]h\b",
        lambda m: "бисмиллаҳ" if m.group(0).islower() else "Бисмиллаҳ",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\balhamdulill[ao]h\b",
        lambda m: "алҳамдулиллаҳ" if m.group(0).islower() else "Алҳамдулиллаҳ",
        text,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\bF+\.\s*Fil\.", "Ффф. Фил.", text)


async def _synthesize_voicelab_wav(
    cfg: dict[str, str], text: str, voice_style: str = "friendly"
) -> bytes:
    """Synthesize Uzbek speech WAV via VoiceLab Lison v2 REST API (200 WAV or 202 async poll)."""
    api_key = cfg["api_key"]
    tts_url = cfg["tts_url"]
    model_id = cfg["model_id"]
    voice_id = (
        cfg.get("neutral_voice_id", NEUTRAL_VOICELAB_VOICE_ID)
        if voice_style == "neutral"
        else cfg["voice_id"]
    )
    speed = 0.95 if voice_style == "neutral" else 1

    idempotency_key = str(uuid.uuid4())
    payload = {
        "text": _prepare_voicelab_tts_text(text),
        "language": "uz",
        "voice_id": voice_id,
        "model_id": model_id,
        "speed": speed,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "audio/wav",
        "Idempotency-Key": idempotency_key,
    }

    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for attempt in range(4):
            async with session.post(tts_url, json=payload, headers=headers) as resp:
                if resp.status == 429 and attempt < 3:
                    await asyncio.sleep(_parse_wait_seconds(resp.headers))
                    continue
                if resp.status == 402:
                    err_body = (await resp.text())[:300]
                    raise VoiceLabCreditsExhaustedError(f"VoiceLab TTS HTTP 402: {err_body}")
                if resp.status == 200:
                    return await resp.read()
                if resp.status == 202:
                    job = await resp.json()
                    status_url = job.get("status_url") or f"/v1/tts/generations/{job.get('id', '')}"
                    full_status_url = urljoin(tts_url, status_url)
                    for _ in range(25):
                        await asyncio.sleep(1.0)
                        async with session.get(
                            full_status_url,
                            headers={"Authorization": f"Bearer {api_key}"},
                        ) as poll_resp:
                            poll_resp.raise_for_status()
                            poll_data = await poll_resp.json()
                            status = poll_data.get("status")
                            if status == "completed" and poll_data.get("audio_url"):
                                async with session.get(poll_data["audio_url"]) as audio_resp:
                                    audio_resp.raise_for_status()
                                    return await audio_resp.read()
                            if status == "failed":
                                raise RuntimeError(poll_data.get("error") or "VoiceLab TTS generation failed")
                    raise TimeoutError("VoiceLab TTS generation timed out")

                err_body = (await resp.text())[:300]
                raise RuntimeError(f"VoiceLab TTS HTTP {resp.status}: {err_body}")

    raise RuntimeError("VoiceLab TTS rate limit retries exhausted")


async def handle_tts(request: web.Request) -> web.Response:
    """Synthesize Zukko Tulki speech strictly via VoiceLab Lison v2 with disk caching."""
    voice_style = "friendly"
    if request.method == "POST":
        try:
            body = await request.json()
            raw_text = body.get("text", "") if isinstance(body, dict) else ""
            raw_style = body.get("voice_style", "friendly") if isinstance(body, dict) else "friendly"
            if str(raw_style).strip().lower() == "neutral":
                voice_style = "neutral"
        except Exception:
            raw_text = ""
    else:
        raw_text = request.query.get("text") or ""
        if (request.query.get("voice_style") or "").strip().lower() == "neutral":
            voice_style = "neutral"

    text = str(raw_text).strip()
    if not text:
        return web.json_response({"ok": False, "error": "text parametri bo'sh"}, status=400)
    if len(text) > 1000:
        return web.json_response({"ok": False, "error": "text juda uzun (maksimum 1000 belgi)"}, status=400)

    cfg: dict[str, str] = request.app["voicelab_config"]
    if not cfg.get("api_key"):
        return web.json_response(
            {"ok": False, "error": "VOICELAB_API_KEY sozlanmagan (.env faylini tekshiring)"},
            status=503,
        )

    cache_dir: Path = request.app["tts_cache_dir"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    vl_voice = (
        cfg.get("neutral_voice_id", NEUTRAL_VOICELAB_VOICE_ID)
        if voice_style == "neutral"
        else cfg["voice_id"]
    )
    tts_text = _prepare_voicelab_tts_text(text)
    vl_digest = hashlib.sha256(f"{cfg['model_id']}:{vl_voice}:{tts_text}".encode("utf-8")).hexdigest()[:24]
    vl_file = cache_dir / f"vl_{vl_digest}.wav"

    if not vl_file.exists():
        lock: asyncio.Lock = request.app["tts_lock"]
        async with lock:
            if not vl_file.exists():
                try:
                    vl_bytes = await _synthesize_voicelab_wav(cfg, text, voice_style=voice_style)
                except VoiceLabCreditsExhaustedError:
                    return web.json_response(
                        {
                            "ok": False,
                            "code": "voicelab_insufficient_credits",
                            "error": "VoiceLab API krediti yetarli emas (HTTP 402). Balansni to'ldiring yoki api.txt/.env ni yangilang.",
                        },
                        status=402,
                    )
                except Exception as exc:
                    return web.json_response({"ok": False, "error": str(exc)}, status=502)
                vl_file.write_bytes(vl_bytes)

    mime_type = _detect_audio_mime(vl_file.read_bytes()[:16])
    return web.FileResponse(
        vl_file,
        headers={"Content-Type": mime_type, "Cache-Control": "public, max-age=86400"},
    )


def create_app() -> web.Application:
    print(f"Loading Uzinfocom FastConformer RNNT model ({STT_MODEL_ID})...", flush=True)
    t0 = time.perf_counter()
    adapter = onnx_asr.load_model(STT_MODEL_ID)
    ts_adapter = adapter.with_timestamps()
    _ = ts_adapter.recognize(np.zeros(8000, dtype=np.float32), sample_rate=SAMPLE_RATE)
    print(f"Uzinfocom RNNT ready in {time.perf_counter() - t0:.2f}s", flush=True)

    project_root = Path(__file__).resolve().parent.parent
    custom_cache_dir = (os.environ.get("ALIFBO_TTS_CACHE_DIR") or "").strip()
    if custom_cache_dir:
        tts_cache_dir = Path(custom_cache_dir)
    elif (project_root / "public").exists():
        tts_cache_dir = project_root / "public" / "audio" / "cache"
    else:
        tts_cache_dir = Path(__file__).resolve().parent / "cache"

    app = web.Application(middlewares=[cors_middleware], client_max_size=10 * 1024 * 1024)
    app["ts_adapter"] = ts_adapter
    app["model_ready"] = True
    app["stt_lock"] = asyncio.Lock()
    app["tts_lock"] = asyncio.Lock()
    app["voicelab_config"] = get_voicelab_config(project_root)
    app["tts_cache_dir"] = tts_cache_dir

    app.router.add_get("/", handle_health)
    app.router.add_get("/health", handle_health)
    app.router.add_get("/api/health", handle_health)
    app.router.add_post("/api/stt", handle_stt)
    app.router.add_get("/api/tts", handle_tts)
    app.router.add_post("/api/tts", handle_tts)
    return app


if __name__ == "__main__":
    # Disable aiohttp access log to ensure no request details or paths are logged alongside audio activity.
    web.run_app(create_app(), host=HOST, port=PORT, access_log=None)
