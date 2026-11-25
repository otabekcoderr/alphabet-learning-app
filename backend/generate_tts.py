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

  --mode voicelab [--voice-id <id>] [--model-id <model_id>]:
      Regenerates all 102 audio clips (sounds, instructions, UI phrases) using
      VoiceLab.uz REST API (default: Malika — Meme streamer on lison-v2) and updates
      audio_review.csv.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urljoin

import requests

UZV_TTS_URL = os.environ.get("UZBEKVOICE_TTS_URL", "https://uzbekvoice.ai/api/v1/tts")
UZV_TASKS_URL = "https://uzbekvoice.ai/api/v1/tasks"
VOICELAB_TTS_URL = os.environ.get("VOICELAB_TTS_URL", "https://api.voicelab.uz/v1/tts")
DEFAULT_VOICELAB_MODEL_ID = os.environ.get("VOICELAB_MODEL_ID", "lison-v2")
MALIKA_VOICE_ID = "voice_83a39d68-22bc-4062-b86e-0a9dd998ba7a"
VOICELAB_VOICE_NAMES = {
    MALIKA_VOICE_ID: "malika",
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

# Alifbo 2.2 plain, neutral (emotionless) letter specification:
# (slug, plain_letter_tts, example_word_tts, display_text)
PLAIN_LETTER_SPEC = [
    ("o", "o", "Olma.", "O. Olma."),
    ("a", "a", "Anor.", "A. Anor."),
    ("n", "n", "Non.", "N. Non."),
    ("i", "i", "Ilon.", "I. Ilon."),
    ("m", "m", "Mushuk.", "M. Mushuk."),
    ("t", "t", "Tog‘.", "T. Tog‘."),
    ("l", "l", "Lola.", "L. Lola."),
    ("b", "b", "Baliq.", "B. Baliq."),
    ("k", "k", "Kitob.", "K. Kitob."),
    ("r", "r", "Ro‘mol.", "R. Ro‘mol."),
    ("u", "u", "Uzum.", "U. Uzum."),
    ("s", "s", "Sabzi.", "S. Sabzi."),
    ("d", "d", "Daraxt.", "D. Daraxt."),
    ("e", "e", "Eshik.", "E. Eshik."),
    ("z", "z harfi", "Zebra.", "Z harfi. Zebra."),
    ("sh", "sh", "Shar.", "Sh. Shar."),
    ("v", "v", "Vagon.", "V. Vagon."),
    ("y", "y", "Yulduz.", "Y. Yulduz."),
    ("g", "g", "Gilos.", "G. Gilos."),
    ("ng", "ng tovushi", "Tong.", "Ng tovushi. Tong."),
    ("o_apostrophe", "o‘", "O‘rdak.", "O‘. O‘rdak."),
    ("ch", "ch", "Choynak.", "Ch. Choynak."),
    ("q", "q", "Qalam.", "Q. Qalam."),
    ("g_apostrophe", "g‘ harfi", "G‘oz.", "G‘ harfi. G‘oz."),
    ("h", "h", "Havo.", "H. Havo."),
    ("j", "j", "Jo‘ja.", "J. Jo‘ja."),
    ("x", "x", "Xo‘roz.", "X. Xo‘roz."),
    ("f", "f", "Fil.", "Fff. Fil."),
    ("p", "p", "Pomidor.", "P. Pomidor."),
    ("tutuq", "tutuq belgisi", "A’lo.", "Tutuq belgisi. A’lo."),
]

PHONETIC_LETTER_MAP = [(slug, display) for slug, _letter, _word, display in PLAIN_LETTER_SPEC]

DIALOG_AUDITION_PHRASES = [
    ("bu_nima", "Topding! Qani ovoz chiqarib ayt-chi: Bu nima?"),
    ("qaytaring_quvnoq", "Yasha! Juda to‘g‘ri! Endi men bilan birga quvnoq qilib qaytar: Ki-tob!"),
    ("motivatsiya_birga", "Hechqisi yo‘q! Keling, birga bo‘g‘inlab aytamiz: Ki - tob! Sen albatta uddalaysan!"),
    ("letter_k_kitob", "K. Kitob."),
    ("letter_sh_shar", "Sh. Shar."),
]

# Pure letter sounds to generate: 15 non-legacy letters + 3 legacy mispronounced vowels/nasal (o, e, n)
LEGACY_LETTER_SOUNDS_TO_FIX = {"o", "e", "n"}
MISSING_LETTER_SOUNDS = [
    (slug, plain_letter)
    for slug, plain_letter, _word, _display in PLAIN_LETTER_SPEC
    if slug in {
        "z", "sh", "y", "g", "ng", "o_apostrophe", "ch", "q",
        "g_apostrophe", "h", "j", "x", "f", "p", "tutuq",
    }
]

INSTRUCTION_PHRASES = [
    ("instr_home_welcome", "Salom, bolajon! Bugun yangi so‘zlarni birga o‘qiymiz! Qani boshladik!"),
    ("instr_home_sleep", "Barakalla! Bugungi mashqni a’lo bajarding! Endi ko‘zlarimiz dam olsin, ertaga yana o‘ynaymiz!"),
    ("instr_alpha_listen", "Quloq sol! Qaysi harfning tovushi eshitildi?"),
    ("instr_alpha_picture", "Harfga mos rasmni top!"),
    ("instr_alpha_say", "Endi bu harf va so‘zni ovoz chiqarib ayt!"),
    ("instr_alpha_chart", "Istalgan harf ustiga bos — tovushini va so‘zini aytib beraman!"),
    ("instr_letter_help_tip", "Harfni unutdingmi? Istalgan harf ustiga bos!"),
    ("instr_stage1_word_hunter", "Rasmga qarab to‘g‘ri so‘zni top va o‘qib ber!"),
    ("instr_stage1_word_hunter_speak", "Endi topgan so‘zingni mikrofonga ovoz chiqarib o‘qib ber!"),
    ("instr_bismillah_speak", "Darsni boshlash uchun mikrofon tugmasini bosib, «Bismillah» deb ayt!"),
    ("instr_alhamdulillah_speak", "Barakalla, mashqlarni zo‘r bajarding! Endi Allohga hamd aytib, «Alhamdulillah» deb ayt!"),
    ("instr_stage1_constructor", "Bo‘g‘inlarni qo‘shib so‘z yasa! Rasmga qarab yetishmayotgan bo‘g‘inni tanla!"),
    ("instr_stage1_bubbles", "Bo‘g‘in pufakchalarini tartib bilan yorib, har birini ovoz chiqarib o‘qi!"),
    ("instr_stage1_bubble_speak", "Ajoyib! Endi bu bo‘g‘inni ovoz chiqarib ayt!"),
    ("instr_stage1_bubble_read_word", "Zo‘r! Endi yig‘ilgan butun so‘zni ovoz chiqarib o‘qi!"),
    ("instr_stage1_bubble_confirm_word", "Zo‘r! Endi yig‘ilgan so‘zni o‘qib, mos rasmni tanla!"),
    ("instr_stage1_sentence", "Rasmga qarab so‘zlarni to‘g‘ri tartibda terib gap tuz!"),
    ("instr_stage2_spotlight_word", "Bo‘g‘inlarni yoritib o‘qi va mos rasmni top!"),
    ("instr_stage2_spotlight_sentence", "So‘zlarni yoritib gapni o‘qi va ma’nosiga mos rasmni top!"),
    ("instr_stage3_exam_voice_word", "Endi bu so‘zni o‘zing mustaqil o‘qib, mikrofonga ayt!"),
    ("instr_stage3_exam_voice_sentence", "Endi bu gapni o‘zing mustaqil o‘qib, mikrofonga ayt!"),
    ("instr_stage3_exam_offline_word", "Endi bu so‘zni o‘zing o‘qib ko‘r va mos rasmni tanla!"),
    ("instr_stage3_exam_offline_sentence", "Endi bu gapni o‘zing o‘qib ko‘r va mos rasmni tanla!"),
    ("instr_comprehension_action", "Gapda nima haqida aytilgan? Ma’nosiga mos rasmni tanla!"),
    ("instr_comp_eat", "Kim nima yedi, ichdi yoki tayyorladi? Mos rasmni tanla!"),
    ("instr_comp_move", "Kim qanday harakat qildi? To‘g‘ri rasmni tanla!"),
    ("instr_comp_nature", "Tabiatda nima sodir bo‘ldi? Mos rasmni tanla!"),
]

FEEDBACK_PHRASES = [
    ("fb_no_speech", "Ovozing eshitilmadi — yana bir bor balandroq aytib ko‘r!"),
    ("fb_louder_clearer", "Yana bir bor balandroq va aniqroq aytib ko‘r!"),
    ("fb_listen_then_try", "Ovoz yaxshi eshitilmadi — eshitib ko‘r, keyin yana o‘qib ber yoki Birga aytamiz tugmasini bos."),
    ("fb_other_word", "Bu boshqa so‘zga o‘xshadi. Harflarga diqqat bilan qarab yana bir bor o‘qi!"),
    ("fb_try_syllables", "Yaxshi harakat! Quloq solib, bo‘g‘inlarga qarab yana bir marta o‘qib ko‘r."),
    ("fb_listen_together", "Keling, so‘zni birga eshitib o‘qiymiz!"),
    ("fb_server_offline_pic", "Ovoz serveri bilan aloqa uzildi. Rasm tanlash orqali davom etamiz."),
    ("fb_mic_blocked_pic", "Mikrofonga ruxsat berilmadi — mos rasmni tanlash rejimiga o‘tamiz."),
    ("fb_offline_look_again", "Yana bir bor so‘zni diqqat bilan o‘qib ko‘r-chi!"),
    ("fb_sentence_order", "So‘zlarni to‘g‘ri tartibda joylashtirib ko‘r!"),
    ("fb_word_hunter_wrong", "Boshqa so‘zga qarab ko‘r! Bo‘g‘inlarni diqqat bilan o‘qi."),
    ("fb_bubble_try_again", "Bu bo‘g‘inni yana bir bor aniqroq aytib ko‘r-chi!"),
    ("fb_bubble_server_offline", "Ovoz serveri bilan aloqa uzildi — eshitib davom etamiz."),
    ("fb_bubble_mic_blocked", "Mikrofonga ruxsat berilmadi — ovozli pauza rejimiga o‘tamiz."),
    ("fb_bubble_listen_repeat", "Tingla va birga ayt!"),
    ("fb_alpha_repeat", "So‘zni yana bir bor aniqroq aytib ko‘r yoki pastdagi tugma bilan davom et!"),
    ("fb_alpha_server_offline", "Ovoz serveri bilan aloqa uzildi — pastdagi tugma bilan davom etishingiz mumkin."),
    ("fb_alpha_mic_blocked", "Mikrofonga ruxsat berilmadi — pastdagi tugma bilan davom eting."),
]

WRONG_FEEDBACK_PHRASES = [
    ("wrong_1", "Yaqin kelding, yana bir urinib ko‘r!"),
    ("wrong_2", "Boshqa rasmni tekshirib ko‘ramizmi?"),
    ("wrong_3", "Hechqisi yo‘q, shoshilmasdan yana qarab ko‘r!"),
    ("wrong_4", "Deyarli topding! Harflarga diqqat bilan qarab yana urinib ko‘r!"),
    ("wrong_5", "Boshqa bo‘g‘inni sinab ko‘ramizmi? Sen albatta topasan!"),
]

PRAISE_PHRASES = [
    ("praise_1", "Barakalla! Juda to‘g‘ri topding!"),
    ("praise_2", "Zo‘r! Sen haqiqiy zukko bolajonsan!"),
    ("praise_3", "Ajoyib! Juda chiroyli o‘qiding!"),
    ("praise_4", "Yasha! Xuddi shunday davom et!"),
    ("praise_round_complete", "Ura! Mashqni a’lo darajada yakunlading! Juda ko‘p yulduzcha to‘plading, barakalla!"),
    ("praise_alphabet_complete", "Ofarin! Barcha harflarni zo‘r takrorlading! Sen haqiqiy chempionsan!"),
]

HABIT_PHRASES = [
    ("bismillah", "Ilming ziyoda bo‘lishi uchun, «Bismillah» deb boshla!"),
    (
        "alhamdulillah",
        "Barakalla, mashqlarni zo‘r bajarding! Endi Allohga hamd aytib, «Alhamdulillah» deb ayt!",
    ),
]

# Phonetic VoiceLab prompt overrides (keeps Latin display text in audio_review.csv while avoiding vowel rounding)
HABIT_TTS_OVERRIDES = {
    "bismillah": "Ilming ziyoda bo‘lishi uchun, «Бисмиллаҳ» deb boshla!",
    "alhamdulillah": "Barakalla, mashqlarni zo‘r bajarding! Endi Allohga hamd aytib, «Алҳамдулиллаҳ» deb ayt!",
    "instr_bismillah_speak": "Darsni boshlash uchun mikrofon tugmasini bosib, «Бисмиллаҳ» deb ayt!",
    "instr_alhamdulillah_speak": "Barakalla, mashqlarni zo‘r bajarding! Endi Allohga hamd aytib, «Алҳамдулиллаҳ» deb ayt!",
}

EXISTING_DYNAMIC_SOUND_IDS = {
    "ona", "ana", "non", "nima", "lola", "olma", "oila", "limon",
    "arra", "asal", "suv", "bola", "bobo", "ota", "dada", "kitob",
}


def to_syllable_slug(syl: str) -> str:
    """Convert an Uzbek syllable/grapheme chunk into a deterministic ASCII filename slug."""
    s = syl.lower()
    s = re.sub(r"o['’‘ʻʼ`´]", "o_ap", s)
    s = re.sub(r"g['’‘ʻʼ`´]", "g_ap", s)
    s = re.sub(r"['’‘ʻʼ`´]", "", s)
    s = re.sub(r"[^a-z0-9_]", "", s)
    return s


def load_curriculum_offline_tasks(project_root: Path) -> tuple[list[tuple[str, str, str]], list[tuple[str, str, str]]]:
    """Parse DYNAMIC_WORD_POOL from src/data/curriculum.ts for offline word & World 1-4 syllable TTS."""
    src_path = project_root / "src" / "data" / "curriculum.ts"
    src = src_path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"makeWordItem\('([^']+)',\s*(\d+),\s*'([^']+)',\s*\[([^\]]+)\],\s*'[^']+',\s*\[[^\]]+\](?:,\s*\[([^\]]+)\])?"
    )
    word_tasks: list[tuple[str, str, str]] = []
    syl_tasks: list[tuple[str, str, str]] = []
    seen_syls: set[str] = set()

    for item_id, world, text, parts_raw, distractor_raw in pattern.findall(src):
        if item_id not in EXISTING_DYNAMIC_SOUND_IDS:
            tts_text = f"{text.capitalize()}."
            kind = "sentence" if world == "5" else "word"
            word_tasks.append((f"word_{item_id}.mp3", tts_text, kind))
        if world in {"1", "2", "3", "4"}:
            for chunk in (parts_raw, distractor_raw or ""):
                for part in re.findall(r"'([^']+)'", chunk):
                    slug = to_syllable_slug(part)
                    if slug and slug not in seen_syls:
                        seen_syls.add(slug)
                        syl_tasks.append((f"syl_{slug}.mp3", f"{part.capitalize()}.", "syllable"))

    return word_tasks, syl_tasks


def read_existing_review_voices(project_root: Path) -> dict[str, str]:
    """Read existing audio_review.csv file->voice map to preserve untouched legacy clips' attribution."""
    csv_path = project_root / "audio_review.csv"
    voices: dict[str, str] = {}
    if not csv_path.exists():
        return voices
    with open(csv_path, "r", newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            rel = (row.get("file") or "").strip()
            voice = (row.get("voice") or "").strip()
            if rel.startswith("public/audio/") and voice:
                voices[rel.removeprefix("public/audio/")] = voice
    return voices


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
    """Convert WAV/audio bytes from TTS CDN to clean 44.1 kHz mono MP3."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [ffmpeg_exe, "-y", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", "44100", "-b:a", "128k", str(out_path)],
        input=audio_bytes,
        capture_output=True,
        check=True,
    )


def concat_audio_with_silence(
    part1_bytes: bytes,
    part2_bytes: bytes,
    out_path: Path,
    ffmpeg_exe: str,
    pause_ms: int = 320,
) -> None:
    """Join two synthesized audio segments with a crisp silence pause into a 44.1 kHz mono MP3."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pause_sec = max(0.05, pause_ms / 1000.0)
    with tempfile.TemporaryDirectory() as tmpdir:
        p1 = Path(tmpdir) / "part1.audio"
        p2 = Path(tmpdir) / "part2.audio"
        p1.write_bytes(part1_bytes)
        p2.write_bytes(part2_bytes)
        filter_graph = (
            "[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[a0];"
            "[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[a1];"
            "[a0][2:a][a1]concat=n=3:v=0:a=1[out]"
        )
        subprocess.run(
            [
                ffmpeg_exe, "-y", "-v", "error",
                "-i", str(p1),
                "-i", str(p2),
                "-f", "lavfi", "-t", f"{pause_sec:.3f}", "-i", "anullsrc=r=44100:cl=mono",
                "-filter_complex", filter_graph,
                "-map", "[out]",
                "-ac", "1", "-ar", "44100", "-b:a", "128k",
                str(out_path),
            ],
            capture_output=True,
            check=True,
        )


def build_clean_f_clips(
    fil_wav_bytes: bytes,
    sound_f_path: Path,
    letter_f_path: Path,
    ffmpeg_exe: str,
) -> None:
    """Build clean voiceless [f:] for sound_f.mp3 and '[f:] + pause + Fil.' for letter_f.mp3 from Malika 'Fil.' WAV."""
    import struct
    import wave

    sound_f_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        fil_in = tmp / "fil_raw.audio"
        fil_16k = tmp / "fil_16k.wav"
        f_pure_wav = tmp / "f_pure.wav"
        fil_in.write_bytes(fil_wav_bytes)
        subprocess.run(
            [ffmpeg_exe, "-y", "-v", "error", "-i", str(fil_in), "-ac", "1", "-ar", "16000", "-f", "wav", str(fil_16k)],
            capture_output=True,
            check=True,
        )
        with wave.open(str(fil_16k), "rb") as wf:
            frames = wf.readframes(wf.getnframes())
            samples = struct.unpack(f"<{len(frames) // 2}h", frames)

        # Find contiguous 10ms frames with voiceless fricative energy (high ZCR, low RMS floor, minimal voicing)
        frame_len = 160  # 10ms at 16kHz
        good_indices: list[int] = []
        for idx in range(0, len(samples) - frame_len, frame_len):
            win = samples[idx : idx + frame_len]
            rms = (sum(x * x for x in win) / frame_len) ** 0.5 / 32768.0
            if rms < 0.008:
                continue
            zc = sum(1 for a, b in zip(win, win[1:]) if (a >= 0) != (b >= 0)) / (frame_len - 1)
            if zc >= 0.30:
                good_indices.append(idx // frame_len)
            elif good_indices and len(good_indices) >= 6:
                break

        if len(good_indices) >= 6:
            # Trim final 1 frame before vowel transition so no voiced [i] leaks in
            start_s = max(0.0, (good_indices[0] * 10) / 1000.0)
            end_s = max(start_s + 0.08, ((good_indices[-1] - 1) * 10) / 1000.0)
            seg_dur = min(0.16, end_s - start_s)
        else:
            start_s = 0.25
            seg_dur = 0.14

        # Extract pure fricative slice, high-pass >= 380 Hz to strip any residual vowel buzz, loop smoothly to ~280ms
        slice_wav = tmp / "f_slice.wav"
        subprocess.run(
            [
                ffmpeg_exe, "-y", "-v", "error",
                "-ss", f"{start_s:.3f}", "-t", f"{seg_dur:.3f}", "-i", str(fil_in),
                "-af", "highpass=f=380,highpass=f=380,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono",
                str(slice_wav),
            ],
            capture_output=True,
            check=True,
        )
        subprocess.run(
            [
                ffmpeg_exe, "-y", "-v", "error",
                "-i", str(slice_wav), "-i", str(slice_wav),
                "-filter_complex", "[0:a][1:a]acrossfade=d=0.03:c1=tri:c2=tri,afade=t=in:st=0:d=0.025,afade=t=out:st=0.21:d=0.045,volume=1.35[out]",
                "-map", "[out]", "-ar", "44100", "-ac", "1", str(f_pure_wav),
            ],
            capture_output=True,
            check=True,
        )
        subprocess.run(
            [ffmpeg_exe, "-y", "-v", "error", "-i", str(f_pure_wav), "-ac", "1", "-ar", "44100", "-b:a", "128k", str(sound_f_path)],
            capture_output=True,
            check=True,
        )
        concat_audio_with_silence(f_pure_wav.read_bytes(), fil_wav_bytes, letter_f_path, ffmpeg_exe, pause_ms=280)


def synthesize_uzbekvoice_bytes(api_key: str, text: str, model: str) -> dict:
    """Call POST https://uzbekvoice.ai/api/v1/tts with retries and return raw audio bytes."""
    last_err: dict = {"ok": False, "http_status": 500, "error": "Unknown error"}
    for attempt in range(4):
        try:
            resp = requests.post(
                UZV_TTS_URL,
                headers={"Authorization": api_key},
                json={"text": text, "model": model, "blocking": "true"},
                timeout=45,
            )
        except Exception as exc:
            last_err = {"ok": False, "http_status": 503, "error": str(exc)}
            if attempt < 3:
                time.sleep(1.5 * (attempt + 1))
                continue
            return last_err

        if resp.status_code == 429 and attempt < 3:
            time.sleep(2.5 * (attempt + 1))
            continue
        if resp.status_code >= 500 and attempt < 3:
            last_err = {"ok": False, "http_status": resp.status_code, "error": resp.text[:300]}
            time.sleep(1.5 * (attempt + 1))
            continue
        if resp.status_code >= 400:
            return {
                "ok": False,
                "http_status": resp.status_code,
                "error": resp.text[:300],
            }

        body = resp.json()
        task_id = body.get("id")
        deadline = time.time() + 35
        while not (body.get("result") or {}).get("url") and time.time() < deadline:
            time.sleep(0.5)
            poll = requests.get(
                UZV_TASKS_URL,
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
        return {
            "ok": True,
            "http_status": resp.status_code,
            "requested_model": body.get("requested_model"),
            "actual_model": body.get("model") or model,
            "model_substituted": body.get("model_substituted"),
            "audio_bytes": media.content,
        }
    return last_err


def synthesize_uzbekvoice(api_key: str, text: str, model: str, out_path: Path, ffmpeg_exe: str) -> dict:
    """Call POST https://uzbekvoice.ai/api/v1/tts and convert to 44.1 kHz mono MP3."""
    res = synthesize_uzbekvoice_bytes(api_key, text, model)
    if not res["ok"]:
        return res
    wav_bytes_to_mp3(res["audio_bytes"], out_path, ffmpeg_exe)
    return {
        "ok": True,
        "http_status": res["http_status"],
        "requested_model": res.get("requested_model"),
        "actual_model": res.get("actual_model"),
        "model_substituted": res.get("model_substituted"),
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


def synthesize_voicelab(
    api_key: str,
    text: str,
    voice_id: str,
    out_path: Path,
    ffmpeg_exe: str,
    model_id: str = DEFAULT_VOICELAB_MODEL_ID,
) -> dict:
    """Call POST https://api.voicelab.uz/v1/tts (Lison v2) and convert returned WAV bytes to MP3."""
    idempotency_key = str(uuid.uuid4())
    for attempt in range(4):
        resp = requests.post(
            VOICELAB_TTS_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": idempotency_key,
                "Accept": "audio/wav",
            },
            json={
                "text": text,
                "language": "uz",
                "voice_id": voice_id,
                "model_id": model_id,
                "speed": 1,
            },
            timeout=60,
        )
        if resp.status_code == 429 and attempt < 3:
            reset_s = _parse_int_header(resp.headers, "Retry-After")
            if reset_s is None:
                reset_s = _parse_int_header(resp.headers, "Ratelimit-Reset")
            wait_s = max(1, (reset_s if reset_s is not None else 2) + 1)
            time.sleep(wait_s)
            continue

        if resp.status_code == 202:
            job = resp.json()
            status_url = urljoin(VOICELAB_TTS_URL, job.get("status_url") or f"/v1/tts/generations/{job.get('id', '')}")
            audio_bytes: bytes | None = None
            for _ in range(25):
                time.sleep(1.0)
                poll = requests.get(
                    status_url,
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=30,
                )
                poll.raise_for_status()
                poll_data = poll.json()
                if poll_data.get("status") == "completed" and poll_data.get("audio_url"):
                    media = requests.get(poll_data["audio_url"], timeout=60)
                    media.raise_for_status()
                    audio_bytes = media.content
                    break
                if poll_data.get("status") == "failed":
                    return {"ok": False, "http_status": 502, "error": poll_data.get("error") or "Async job failed"}
            if audio_bytes is None:
                return {"ok": False, "http_status": 504, "error": "Async TTS job timed out"}
            wav_bytes_to_mp3(audio_bytes, out_path, ffmpeg_exe)
            return {
                "ok": True,
                "http_status": 200,
                "bytes": out_path.stat().st_size,
                "duration_ms": None,
                "credits_used": None,
                "ratelimit_remaining": _parse_int_header(resp.headers, "Ratelimit-Remaining"),
                "ratelimit_reset": _parse_int_header(resp.headers, "Ratelimit-Reset"),
            }

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


def write_review_csv(
    project_root: Path,
    sample_rows: list[dict],
    active_voice: str | None = None,
    provider: str = "uzbekvoice",
    file_voice_map: dict[str, str] | None = None,
    extra_rows: list[dict] | None = None,
    sound_text_overrides: dict[str, str] | None = None,
) -> Path:
    """Write audio_review.csv tracking voice attribution and review status for every static file."""
    rows = []
    for item_id, kind, short_sound, teacher_prompt in CURRICULUM_AUDIO:
        sound_fname = f"sound_{item_id}.mp3"
        item_fname = f"item_{item_id}.mp3"
        effective_short_sound = (sound_text_overrides or {}).get(sound_fname, short_sound)
        if file_voice_map is not None:
            fallback_tag = f"{provider}:{active_voice or 'malika'}"
            rows.append({
                "file": f"public/audio/{sound_fname}",
                "text": effective_short_sound,
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
                "text": effective_short_sound,
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
            voice_tag = file_voice_map.get(ui_fname, f"{provider}:{active_voice or 'malika'}")
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
    if extra_rows:
        rows.extend(extra_rows)

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


def run_voicelab_full(
    project_root: Path,
    api_key: str,
    voice_id: str,
    model_id: str = DEFAULT_VOICELAB_MODEL_ID,
) -> None:
    """Regenerate all 102 static MP3 clips using VoiceLab.uz (Lison v2) with local cache."""
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
    print(
        f"Synthesizing {total} files with VoiceLab model={model_id}, voice={voice_label} ({voice_id}) ...",
        flush=True,
    )
    synthesized = 0
    skipped = 0
    file_voice_map: dict[str, str] = {}

    for idx, (fname, text) in enumerate(tasks, start=1):
        out_path = audio_dir / fname
        cached_entry = cache.get(fname)
        if out_path.exists() and cached_entry == {
            "voice_id": voice_id,
            "model_id": model_id,
            "text": text,
        }:
            skipped += 1
            file_voice_map[fname] = f"voicelab:{model_id}:{voice_label}"
            print(f"  [{idx:03d}/{total}] {fname:<26} CACHED ({voice_label})", flush=True)
            continue

        res = synthesize_voicelab(api_key, text, voice_id, out_path, ffmpeg_exe, model_id=model_id)
        if not res["ok"]:
            sys.exit(
                f"VoiceLab synthesis failed at {idx}/{total} ({fname}): "
                f"HTTP {res.get('http_status')}: {res.get('error')}"
            )

        synthesized += 1
        file_voice_map[fname] = f"voicelab:{model_id}:{voice_label}"
        cache[fname] = {"voice_id": voice_id, "model_id": model_id, "text": text}
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

    csv_path = write_review_csv(
        project_root,
        [],
        active_voice=voice_label,
        provider="voicelab",
        file_voice_map=file_voice_map,
    )
    print(
        f"Sync complete (new={synthesized}, cached={skipped}, model={model_id}, voice={voice_label}). "
        f"Manifest updated: {csv_path}",
        flush=True,
    )


def run_audition(project_root: Path) -> None:
    """Generate cheerful dialog and difficult-letter audition clips across available TTS voices."""
    audition_dir = project_root / "public" / "audio" / "voice_audition"
    audition_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg_exe = find_ffmpeg()

    def try_env(var_name: str) -> str | None:
        val = os.environ.get(var_name, "").strip()
        if val:
            return val
        env_file = project_root / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    k, v = stripped.split("=", 1)
                    if k.strip() == var_name:
                        return v.strip().strip('"').strip("'")
        return None

    uzv_key = try_env("UZBEKVOICE_API_KEY")
    vl_key = try_env("VOICELAB_API_KEY")
    if not uzv_key and not vl_key:
        sys.exit("Na UZBEKVOICE_API_KEY, na VOICELAB_API_KEY topilmadi.")

    if vl_key:
        for vid, vname in VOICELAB_VOICE_NAMES.items():
            for key, phrase in DIALOG_AUDITION_PHRASES:
                out_path = audition_dir / f"voicelab_{vname}_{key}.mp3"
                res = synthesize_voicelab(
                    vl_key,
                    phrase,
                    vid,
                    out_path,
                    ffmpeg_exe,
                    model_id=DEFAULT_VOICELAB_MODEL_ID,
                )
                print(f"  [voicelab:{vname}] {key}.mp3 -> {'OK' if res['ok'] else res.get('error')}")
                time.sleep(0.35)

    if uzv_key:
        for vname in DISTINCT_VOICES:
            for key, phrase in DIALOG_AUDITION_PHRASES:
                out_path = audition_dir / f"uzbekvoice_{vname}_{key}.mp3"
                res = synthesize_uzbekvoice(uzv_key, phrase, vname, out_path, ffmpeg_exe)
                print(f"  [uzbekvoice:{vname}] {key}.mp3 -> {'OK' if res['ok'] else res.get('error')}")
                time.sleep(0.25)

    print(f"Audition clips saved to: {audition_dir}")


def _load_optional_env_secret(project_root: Path, var_name: str) -> str:
    val = os.environ.get(var_name, "").strip()
    if val:
        return val
    env_file = project_root / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            k, v = stripped.split("=", 1)
            if k.strip() == var_name:
                return v.strip().strip('"').strip("'")
    return ""


def _load_voicelab_api_keys(project_root: Path, primary_key: str) -> list[str]:
    """Collect unique VoiceLab API keys in priority order from primary_key, VOICELAB_API_KEYS, VOICELAB_API_KEY, and api.txt."""
    candidates: list[str] = []
    if primary_key.strip():
        candidates.append(primary_key.strip())
    for raw_list in (_load_optional_env_secret(project_root, "VOICELAB_API_KEYS"),):
        if raw_list:
            for part in re.split(r"[\s,;]+", raw_list):
                if part.strip():
                    candidates.append(part.strip())
    fallback_single = _load_optional_env_secret(project_root, "VOICELAB_API_KEY")
    if fallback_single:
        candidates.append(fallback_single)
    api_txt = project_root / "api.txt"
    if api_txt.exists():
        for tok in re.findall(r"vlk_[A-Za-z0-9_-]+", api_txt.read_text(encoding="utf-8")):
            if tok.strip():
                candidates.append(tok.strip())

    unique: list[str] = []
    seen: set[str] = set()
    for key in candidates:
        if key not in seen:
            seen.add(key)
            unique.append(key)
    return unique


def _synthesize_single_voicelab_bytes(
    api_key: str, text: str, voice_id: str, model_id: str, speed: float = 1.0
) -> dict:
    idempotency_key = str(uuid.uuid4())
    is_short_prompt = len(text.strip()) < 20
    connect_timeouts = 0
    last_err: dict = {"ok": False, "http_status": 500, "error": "VoiceLab synthesis error"}

    for attempt in range(6):
        try:
            resp = requests.post(
                VOICELAB_TTS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "Idempotency-Key": idempotency_key,
                    "Accept": "audio/wav",
                },
                json={
                    "text": text,
                    "language": "uz",
                    "voice_id": voice_id,
                    "model_id": model_id,
                    "speed": speed,
                },
                timeout=(10, 50),
            )
        except requests.exceptions.ConnectTimeout as exc:
            connect_timeouts += 1
            last_err = {
                "ok": False,
                "http_status": 504,
                "error_kind": "connect_timeout",
                "error": f"ConnectTimeout: {exc}",
            }
            if connect_timeouts >= 2:
                return last_err
            time.sleep(1.0)
            continue
        except requests.RequestException as exc:
            last_err = {"ok": False, "http_status": 503, "error": str(exc)}
            if attempt < 5:
                time.sleep(min(8.0, 1.0 * (2 ** min(attempt, 3))))
                continue
            return last_err

        if resp.status_code in (401, 402, 403):
            return {
                "ok": False,
                "http_status": resp.status_code,
                "error_kind": "fatal_auth_or_credits",
                "error": resp.text[:300],
            }

        if resp.status_code == 429:
            reset_s = _parse_int_header(resp.headers, "Retry-After")
            if reset_s is None:
                reset_s = _parse_int_header(resp.headers, "Ratelimit-Reset")
            wait_s = max(1, (reset_s if reset_s is not None else min(10, 2 ** min(attempt, 3))) + 1)
            last_err = {"ok": False, "http_status": 429, "error": resp.text[:300]}
            if attempt < 5:
                time.sleep(wait_s)
                continue
            return last_err

        if resp.status_code >= 500:
            last_err = {"ok": False, "http_status": resp.status_code, "error": resp.text[:300]}
            if attempt < 5:
                time.sleep(min(8.0, 1.0 * (2 ** min(attempt, 3))))
                continue
            return last_err

        audio_bytes: bytes | None = None
        if resp.status_code == 202:
            try:
                job = resp.json()
                status_url = urljoin(VOICELAB_TTS_URL, job.get("status_url") or f"/v1/tts/generations/{job.get('id', '')}")
                for _ in range(25):
                    time.sleep(1.0)
                    poll = requests.get(
                        status_url,
                        headers={"Authorization": f"Bearer {api_key}"},
                        timeout=(10, 30),
                    )
                    poll.raise_for_status()
                    poll_data = poll.json()
                    if poll_data.get("status") == "completed" and poll_data.get("audio_url"):
                        media = requests.get(poll_data["audio_url"], timeout=(10, 50))
                        media.raise_for_status()
                        audio_bytes = media.content
                        break
                    if poll_data.get("status") == "failed":
                        return {"ok": False, "http_status": 502, "error": poll_data.get("error") or "Async job failed"}
            except requests.RequestException as exc:
                last_err = {"ok": False, "http_status": 503, "error": str(exc)}
                if attempt < 5:
                    time.sleep(min(8.0, 1.0 * (2 ** min(attempt, 3))))
                    continue
                return last_err
            if audio_bytes is None:
                return {"ok": False, "http_status": 504, "error": "Async TTS job timed out"}
        elif resp.status_code >= 400:
            return {"ok": False, "http_status": resp.status_code, "error": resp.text[:300]}
        else:
            audio_bytes = resp.content

        if is_short_prompt and len(audio_bytes) > 576_044:
            last_err = {
                "ok": False,
                "http_status": 502,
                "error": f"Runaway audio guard triggered ({len(audio_bytes)} B for {len(text.strip())} chars)",
            }
            if attempt < 1:
                idempotency_key = str(uuid.uuid4())
                time.sleep(0.5)
                continue
            return last_err

        return {
            "ok": True,
            "http_status": 200,
            "audio_bytes": audio_bytes,
            "credits_used": _parse_int_header(resp.headers, "X-Voicelab-Credits-Used"),
        }

    return last_err


def run_voicelab_offline_full(
    project_root: Path,
    api_key: str,
    voice_id: str,
    model_id: str = DEFAULT_VOICELAB_MODEL_ID,
    sync_csv_only: bool = False,
    provider: str = "voicelab",
    uzv_voice: str = "shoira",
    workers: int = 3,
    force_letters: bool = False,
    only_tier1: bool = False,
    letter_voice_id: str = MALIKA_VOICE_ID,
) -> None:
    """Synthesize ALL offline-required static MP3 clips strictly with VoiceLab Lison v2 by default."""
    audio_dir = project_root / "public" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    cache_path = audio_dir / ".offline_tts_cache.json"
    legacy_vl_cache_path = audio_dir / ".voicelab_cache.json"
    ffmpeg_exe = None if sync_csv_only else find_ffmpeg()

    use_uzv_direct = provider == "uzbekvoice"
    strict_voicelab = provider == "voicelab"
    uzv_key = "" if strict_voicelab else _load_optional_env_secret(project_root, "UZBEKVOICE_API_KEY")
    vl_keys = [] if use_uzv_direct else _load_voicelab_api_keys(project_root, api_key)
    vl_key = vl_keys[0] if vl_keys else ""

    cache: dict[str, dict[str, str]] = {}
    if legacy_vl_cache_path.exists():
        try:
            old_loaded = json.loads(legacy_vl_cache_path.read_text(encoding="utf-8"))
            if isinstance(old_loaded, dict):
                for k, v in old_loaded.items():
                    if isinstance(v, dict):
                        cache[k] = {
                            "provider": "voicelab",
                            "voice": VOICELAB_VOICE_NAMES.get(v.get("voice_id", ""), v.get("voice_id", "malika")),
                            "text": str(v.get("text", "")),
                        }
        except Exception:
            pass
    if cache_path.exists():
        try:
            loaded = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                cache.update(loaded)
        except Exception:
            pass

    word_tasks, syl_tasks = load_curriculum_offline_tasks(project_root)
    legacy_voices = read_existing_review_voices(project_root)

    # (fname, text, kind, letter_pair_or_None, is_letter_clip, is_tier1)
    offline_tasks: list[tuple[str, str, str, tuple[str, str] | None, bool, bool]] = []
    for slug, plain_letter, ex_word, display in PLAIN_LETTER_SPEC:
        offline_tasks.append((f"letter_{slug}.mp3", display, "letter recall", (plain_letter, ex_word), True, True))
    for slug, plain_letter, _ex_word, _display in PLAIN_LETTER_SPEC:
        if slug in LEGACY_LETTER_SOUNDS_TO_FIX or any(s == slug for s, _ in MISSING_LETTER_SOUNDS):
            offline_tasks.append((f"sound_{slug}.mp3", plain_letter, "letter sound", None, True, True))
    for key, phrase in INSTRUCTION_PHRASES:
        offline_tasks.append((f"{key}.mp3", phrase, "instruction", None, False, True))
    for key, phrase in FEEDBACK_PHRASES:
        offline_tasks.append((f"{key}.mp3", phrase, "feedback", None, False, True))
    for key, phrase in WRONG_FEEDBACK_PHRASES:
        offline_tasks.append((f"{key}.mp3", phrase, "wrong feedback", None, False, True))
    for key, phrase in PRAISE_PHRASES:
        offline_tasks.append((f"{key}.mp3", phrase, "praise", None, False, True))
    for key, kind, phrase in UI_PHRASES:
        offline_tasks.append((f"{key}.mp3", phrase, kind, None, False, True))
    for key, phrase in HABIT_PHRASES:
        offline_tasks.append((f"{key}.mp3", phrase, "habit", None, False, True))
    tts_override_by_fname = {f"{key}.mp3": prompt for key, prompt in HABIT_TTS_OVERRIDES.items()}
    for fname, text, kind in word_tasks:
        offline_tasks.append((fname, text, kind, None, False, False))
    for fname, text, kind in syl_tasks:
        offline_tasks.append((fname, text, kind, None, False, False))

    # Enforce single Malika Lison v2 voice whenever provider is voicelab
    if strict_voicelab:
        voice_id = MALIKA_VOICE_ID
        letter_voice_id = MALIKA_VOICE_ID

    existing_offline_fnames = {t[0] for t in offline_tasks}
    tier3_tasks: list[tuple[str, str, str, tuple[str, str] | None, bool, bool]] = []
    if not only_tier1:
        for item_id, kind, short_sound, teacher_prompt in CURRICULUM_AUDIO:
            for fname, text, row_kind in (
                (f"sound_{item_id}.mp3", short_sound, kind),
                (f"item_{item_id}.mp3", teacher_prompt, "instruction"),
            ):
                if fname not in existing_offline_fnames and "malika" not in legacy_voices.get(fname, "").lower():
                    tier3_tasks.append((fname, text, row_kind, None, False, False))
                    offline_tasks.append(tier3_tasks[-1])
                    existing_offline_fnames.add(fname)
    tier3_fnames = {t[0] for t in tier3_tasks}

    synthesis_queue = [
        (idx, t)
        for idx, t in enumerate(offline_tasks, start=1)
        if not only_tier1 or t[5]
    ]
    total = len(synthesis_queue)
    ui_fnames = {f"{key}.mp3" for key, _kind, _phrase in UI_PHRASES}
    legacy_sound_fnames = {f"sound_{s}.mp3" for s in LEGACY_LETTER_SOUNDS_TO_FIX}
    legacy_curriculum_fnames = {
        f"sound_{item_id}.mp3" for item_id, *_ in CURRICULUM_AUDIO
    } | {
        f"item_{item_id}.mp3" for item_id, *_ in CURRICULUM_AUDIO
    }

    vl_key_idx = 0
    total_credits_used = 0
    vl_exhausted = (not vl_keys) or use_uzv_direct
    state_lock = threading.Lock()
    pace_lock = threading.Lock()
    last_vl_req_ts = 0.0
    abort_event = threading.Event()
    synthesized = 0
    skipped = 0
    errors: list[str] = []

    print(
        f"{'Syncing CSV for' if sync_csv_only else 'Synthesizing'} {total} offline static clips "
        f"(provider={provider}, tier1_only={only_tier1}, workers={workers}, vl_keys={len(vl_keys)}) ...",
        flush=True,
    )

    def synthesize_task(idx: int, task: tuple[str, str, str, tuple[str, str] | None, bool, bool]) -> None:
        nonlocal vl_exhausted, synthesized, skipped, last_vl_req_ts
        if abort_event.is_set():
            return
        fname, text, _kind, letter_pair, is_letter_clip, _is_tier1 = task
        effective_tts_text = tts_override_by_fname.get(fname, text)
        out_path = audio_dir / fname

        cached = cache.get(fname)
        should_skip = False
        if out_path.exists() and out_path.stat().st_size > 1000 and cached:
            if fname in {"sound_f.mp3", "letter_f.mp3"} and strict_voicelab:
                should_skip = True
            elif is_letter_clip and force_letters:
                should_skip = False
            elif strict_voicelab:
                cached_voice = str(cached.get("voice") or "").lower()
                should_skip = (
                    cached.get("provider") == "voicelab"
                    and "malika" in cached_voice
                    and cached.get("text") == effective_tts_text
                )
            elif cached.get("text") == effective_tts_text:
                if is_letter_clip:
                    should_skip = cached.get("provider") == "uzbekvoice" or cached.get("voice") == "gulnoza"
                else:
                    should_skip = True

        if should_skip:
            with state_lock:
                skipped += 1
            return

        assert ffmpeg_exe is not None

        def synth_text_bytes(txt: str, prefer_neutral: bool) -> tuple[bytes, str, str]:
            nonlocal vl_exhausted, vl_key_idx, total_credits_used, last_vl_req_ts
            if abort_event.is_set():
                raise RuntimeError("Aborted due to earlier fatal VoiceLab error")
            while True:
                with state_lock:
                    can_try_vl = (not vl_exhausted) and (vl_key_idx < len(vl_keys)) and (not use_uzv_direct)
                    cur_idx = vl_key_idx
                    cur_key = vl_keys[cur_idx] if can_try_vl else ""
                if not can_try_vl:
                    break
                if strict_voicelab:
                    with pace_lock:
                        now = time.monotonic()
                        wait_delta = 0.35 - (now - last_vl_req_ts)
                        if wait_delta > 0:
                            time.sleep(wait_delta)
                        last_vl_req_ts = time.monotonic()
                target_vid = letter_voice_id if prefer_neutral else voice_id
                spd = 0.95 if prefer_neutral else 1.0
                res_vl = _synthesize_single_voicelab_bytes(cur_key, txt, target_vid, model_id, speed=spd)
                if res_vl["ok"]:
                    credits = res_vl.get("credits_used") or 0
                    if credits:
                        with state_lock:
                            total_credits_used += int(credits)
                    vlabel = VOICELAB_VOICE_NAMES.get(target_vid, target_vid)
                    return res_vl["audio_bytes"], "voicelab", f"{model_id}:{vlabel}"
                if res_vl.get("http_status") in (401, 402, 403):
                    should_retry = False
                    with state_lock:
                        if vl_key_idx == cur_idx and vl_key_idx + 1 < len(vl_keys):
                            vl_key_idx += 1
                            next_hash = hashlib.sha256(vl_keys[vl_key_idx].encode("utf-8")).hexdigest()[:12]
                            print(
                                f"  Rotating VoiceLab API key -> #{vl_key_idx + 1}/{len(vl_keys)} (sha256[:12]={next_hash})",
                                flush=True,
                            )
                            should_retry = True
                        elif vl_key_idx > cur_idx and vl_key_idx < len(vl_keys) and not vl_exhausted:
                            should_retry = True
                        else:
                            vl_exhausted = True
                            if strict_voicelab:
                                abort_event.set()
                    if should_retry:
                        continue
                elif res_vl.get("error_kind") == "connect_timeout" and strict_voicelab:
                    abort_event.set()
                if strict_voicelab or not uzv_key:
                    raise RuntimeError(f"VoiceLab HTTP {res_vl.get('http_status')}: {res_vl.get('error')}")
                break

            if strict_voicelab:
                raise RuntimeError("VoiceLab krediti tugagan yoki mavjud emas (strict VoiceLab rejimi).")
            if not uzv_key:
                raise RuntimeError("UZBEKVOICE_API_KEY topilmadi va VoiceLab mavjud emas.")
            res_uv = synthesize_uzbekvoice_bytes(uzv_key, txt, uzv_voice)
            if not res_uv["ok"]:
                raise RuntimeError(f"UzbekVoice HTTP {res_uv.get('http_status')}: {res_uv.get('error')}")
            return res_uv["audio_bytes"], "uzbekvoice", str(res_uv.get("actual_model") or uzv_voice)

        if letter_pair is not None and not strict_voicelab:
            part1_txt, part2_txt = letter_pair
            b1, prov1, voice1 = synth_text_bytes(part1_txt, prefer_neutral=True)
            b2, _prov2, _voice2 = synth_text_bytes(part2_txt, prefer_neutral=True)
            concat_audio_with_silence(b1, b2, out_path, ffmpeg_exe, pause_ms=320)
            used_prov, used_voice = prov1, voice1
        else:
            # In VoiceLab mode, each letter_<slug>.mp3 uses 1 single plain neutral API call (`display`).
            b1, used_prov, used_voice = synth_text_bytes(effective_tts_text, prefer_neutral=is_letter_clip)
            wav_bytes_to_mp3(b1, out_path, ffmpeg_exe)

        with state_lock:
            synthesized += 1
            cache[fname] = {"provider": used_prov, "voice": used_voice, "text": effective_tts_text}
            if synthesized % 5 == 0 or is_letter_clip:
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
            print(
                f"  [{idx:03d}/{total}] {fname:<36} OK ({used_prov}:{used_voice}, {out_path.stat().st_size} B)",
                flush=True,
            )

    try:
        if not sync_csv_only:
            max_w = max(1, min(workers, 4))
            tier1_queue = [(idx, t) for idx, t in synthesis_queue if t[5]]
            tier2_queue = [(idx, t) for idx, t in synthesis_queue if not t[5] and t[0] not in tier3_fnames]
            tier3_queue = [(idx, t) for idx, t in synthesis_queue if t[0] in tier3_fnames]
            for phase_queue in (tier1_queue, tier2_queue, tier3_queue):
                if not phase_queue or abort_event.is_set():
                    continue
                with ThreadPoolExecutor(max_workers=max_w) as pool:
                    futures = []
                    for idx, t in phase_queue:
                        if abort_event.is_set():
                            break
                        futures.append((idx, t[0], pool.submit(synthesize_task, idx, t)))
                    for idx, fname, fut in futures:
                        try:
                            fut.result()
                        except Exception as exc:
                            errors.append(f"[{idx}/{total}] {fname}: {exc}")
                            print(f"  ERR [{idx:03d}/{total}] {fname}: {exc}", flush=True)
            cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
            # Build clean voiceless [f:] clips for F (eliminates leading 'Eff' vowel)
            if strict_voicelab and not abort_event.is_set() and (
                force_letters
                or not cache.get("sound_f.mp3", {}).get("clean_f")
                or not cache.get("letter_f.mp3", {}).get("clean_f")
                or not (audio_dir / "sound_f.mp3").exists()
                or not (audio_dir / "letter_f.mp3").exists()
            ):
                assert ffmpeg_exe is not None
                for key_try in vl_keys[vl_key_idx:] or vl_keys:
                    fil_res = _synthesize_single_voicelab_bytes(key_try, "Fil.", MALIKA_VOICE_ID, model_id, speed=0.95)
                    if fil_res.get("ok"):
                        build_clean_f_clips(
                            fil_res["audio_bytes"],
                            audio_dir / "sound_f.mp3",
                            audio_dir / "letter_f.mp3",
                            ffmpeg_exe,
                        )
                        cache["sound_f.mp3"] = {"provider": "voicelab", "voice": f"{model_id}:malika", "text": "f", "clean_f": True}
                        cache["letter_f.mp3"] = {"provider": "voicelab", "voice": f"{model_id}:malika", "text": "Fff. Fil.", "clean_f": True}
                        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
                        print("  [F-FIX] Rebuilt sound_f.mp3 & letter_f.mp3 with pure voiceless [f:]", flush=True)
                        break
    finally:
        file_voice_map = dict(legacy_voices)
        sound_text_overrides: dict[str, str] = {}
        extra_rows: list[dict] = []
        for fname in legacy_curriculum_fnames:
            cached = cache.get(fname)
            if cached and cached.get("provider") == "voicelab" and cached.get("voice"):
                v = cached["voice"]
                norm_v = v if v.startswith("voicelab:") else f"voicelab:{v}"
                file_voice_map[fname] = f"voicelab:{model_id}:malika" if norm_v == "voicelab:malika" else norm_v
        for fname, text, kind, _pair, _is_letter, _is_tier1 in offline_tasks:
            out_path = audio_dir / fname
            if not (out_path.exists() and out_path.stat().st_size > 1000):
                continue
            cached = cache.get(fname)
            raw_tag = (
                f"{cached['provider']}:{cached['voice']}"
                if cached and cached.get("provider") and cached.get("voice")
                else file_voice_map.get(fname, f"voicelab:{model_id}:malika")
            )
            voice_tag = f"voicelab:{model_id}:malika" if raw_tag == "voicelab:malika" else raw_tag
            if fname in ui_fnames or fname in legacy_curriculum_fnames:
                file_voice_map[fname] = voice_tag
                if fname in legacy_sound_fnames:
                    sound_text_overrides[fname] = text
            else:
                extra_rows.append({
                    "file": f"public/audio/{fname}",
                    "text": text,
                    "type": kind,
                    "voice": voice_tag,
                    "status": "needs teacher review",
                })

        csv_path = write_review_csv(
            project_root,
            [],
            active_voice=uzv_voice if use_uzv_direct else VOICELAB_VOICE_NAMES.get(voice_id, voice_id),
            provider="uzbekvoice" if use_uzv_direct else "voicelab",
            file_voice_map=file_voice_map,
            extra_rows=extra_rows,
            sound_text_overrides=sound_text_overrides,
        )
        key_summary = ""
        if vl_keys and not use_uzv_direct:
            active_idx = min(vl_key_idx, len(vl_keys) - 1)
            active_hash = hashlib.sha256(vl_keys[active_idx].encode("utf-8")).hexdigest()[:12]
            key_summary = f", active_key=#{active_idx + 1}/{len(vl_keys)} (sha256[:12]={active_hash})"
            if total_credits_used > 0:
                key_summary += f", credits_used={total_credits_used}"
        print(
            f"Offline sync manifest updated ({len(extra_rows)} extra rows, new={synthesized}, skipped={skipped}{key_summary}): {csv_path}",
            flush=True,
        )

    if errors:
        sys.exit(f"{len(errors)} synthesis error(s). First: {errors[0]}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate static TTS audio & review CSV")
    ap.add_argument(
        "--mode",
        choices=["samples", "full", "voicelab", "offline-full", "audition"],
        default="samples",
    )
    ap.add_argument("--voice", default="shoira", help="Voice model for --mode full")
    ap.add_argument(
        "--voice-id",
        default=os.environ.get("VOICELAB_VOICE_ID", MALIKA_VOICE_ID),
        help="VoiceLab voice ID for --mode voicelab / offline-full",
    )
    ap.add_argument(
        "--letter-voice-id",
        default=MALIKA_VOICE_ID,
        help="VoiceLab voice ID for neutral plain letter clips (default: Malika)",
    )
    ap.add_argument(
        "--model-id",
        default=DEFAULT_VOICELAB_MODEL_ID,
        help="VoiceLab model ID for --mode voicelab / offline-full (default: lison-v2)",
    )
    ap.add_argument(
        "--provider",
        choices=["voicelab", "auto", "uzbekvoice"],
        default="voicelab",
        help="TTS provider for --mode offline-full (default: voicelab)",
    )
    ap.add_argument(
        "--uzv-voice",
        default="shoira",
        help="UzbekVoice model when --provider uzbekvoice/auto is explicitly selected (default: shoira)",
    )
    ap.add_argument(
        "--workers",
        type=int,
        default=3,
        help="Concurrent workers for --mode offline-full (default: 3)",
    )
    ap.add_argument(
        "--only-tier1",
        action="store_true",
        help="Generate only Tier 1 clips (letters, sounds, instructions, feedback, wrong, praise)",
    )
    ap.add_argument(
        "--force-letters",
        action="store_true",
        help="Force regeneration of all 30 letter_*.mp3 and plain sound_*.mp3 clips",
    )
    ap.add_argument(
        "--sync-csv-only",
        action="store_true",
        help="Only refresh audio_review.csv from existing static files on disk without calling TTS API",
    )
    args = ap.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    if args.mode == "audition":
        run_audition(project_root)
    elif args.mode == "offline-full":
        vl_key = "" if (args.sync_csv_only or args.provider == "uzbekvoice") else _load_optional_env_secret(project_root, "VOICELAB_API_KEY")
        run_voicelab_offline_full(
            project_root,
            vl_key,
            args.voice_id,
            model_id=args.model_id,
            sync_csv_only=args.sync_csv_only,
            provider=args.provider,
            uzv_voice=args.uzv_voice,
            workers=args.workers,
            force_letters=args.force_letters,
            only_tier1=args.only_tier1,
            letter_voice_id=args.letter_voice_id,
        )
    elif args.mode == "voicelab":
        vl_key = load_voicelab_api_key(project_root)
        run_voicelab_full(project_root, vl_key, args.voice_id, model_id=args.model_id)
    elif args.mode == "samples":
        uzv_key = load_api_key(project_root)
        run_samples(project_root, uzv_key)
    else:
        uzv_key = load_api_key(project_root)
        run_full(project_root, uzv_key, args.voice)


if __name__ == "__main__":
    main()
