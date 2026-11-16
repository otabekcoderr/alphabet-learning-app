#!/usr/bin/env python3
"""Local Alifbo Voice AI server (aiohttp on 127.0.0.1:8765).

Privacy guarantees enforced by design:
- Child audio bytes received in POST /api/stt are decoded strictly in memory
  (io.BytesIO / subprocess stdin pipe) and never written to disk.
- No child audio, transcript, or normalized recognition output is ever logged
  or persisted by this server.
- Runtime /api/tts is disabled by default and exposed only when ALIFBO_DEV_TTS=1.
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
import wave
from pathlib import Path

import numpy as np
import onnx_asr
from aiohttp import web

HOST = os.environ.get("ALIFBO_HOST", "127.0.0.1")
PORT = int(os.environ.get("ALIFBO_PORT", "8765"))
SAMPLE_RATE = 16_000
SILENCE_RMS_FLOOR = 0.015

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
    pad_ms: int = 150,
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


def evaluate_match(expected: str, accept_raw: str, transcript: str, is_silence: bool) -> bool:
    if is_silence or not transcript.strip():
        return False
    accepted_set = {normalize_uzbek(expected)} if expected.strip() else set()
    for part in (accept_raw or "").split("|"):
        norm_part = normalize_uzbek(part)
        if norm_part:
            accepted_set.add(norm_part)
    norm_tr = normalize_uzbek(transcript)
    return norm_tr in accepted_set


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
    return web.json_response({"ok": True, "model": "uzinfocom-rnnt", "status": "ready"})


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

    if not has_speech or len(trimmed) < 1600:
        return web.json_response(
            {
                "ok": True,
                "transcript": "",
                "normalized": "",
                "accepted": False,
                "is_silence": True,
                "confidence": 0.0,
                "latency_ms": 0,
                "orig_ms": info["orig_ms"],
                "trimmed_ms": info["trimmed_ms"],
            }
        )

    ts_adapter = request.app["ts_adapter"]
    lock: asyncio.Lock = request.app["stt_lock"]
    async with lock:
        res = await asyncio.to_thread(ts_adapter.recognize, trimmed, sample_rate=SAMPLE_RATE)

    latency_ms = round((time.perf_counter() - t0) * 1000)
    transcript = (res.text or "").strip()
    is_silence = len(transcript) == 0
    probs = [math.exp(lp) for lp in (res.logprobs or [])]
    confidence = round(float(sum(probs) / len(probs)), 3) if probs else 0.0
    accepted = evaluate_match(expected, accept_raw, transcript, is_silence)

    return web.json_response(
        {
            "ok": True,
            "transcript": transcript,
            "normalized": normalize_uzbek(transcript),
            "accepted": accepted,
            "is_silence": is_silence,
            "confidence": confidence,
            "latency_ms": latency_ms,
            "orig_ms": info["orig_ms"],
            "trimmed_ms": info["trimmed_ms"],
        }
    )


async def handle_dev_tts(request: web.Request) -> web.Response:
    """Dev-only TTS fallback enabled only when ALIFBO_DEV_TTS=1."""
    import edge_tts

    text = (request.query.get("text") or "").strip()
    if not text:
        return web.json_response({"ok": False, "error": "text parametri bo'sh"}, status=400)

    cache_dir: Path = request.app["tts_cache_dir"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(f"uz-UZ-MadinaNeural:-12%:{text}".encode("utf-8")).hexdigest()[:20]
    out_file = cache_dir / f"{digest}.mp3"

    if not out_file.exists():
        comm = edge_tts.Communicate(text, "uz-UZ-MadinaNeural", rate="-12%")
        await comm.save(str(out_file))

    return web.FileResponse(out_file, headers={"Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400"})


def create_app() -> web.Application:
    print("Loading Uzinfocom FastConformer RNNT model...", flush=True)
    t0 = time.perf_counter()
    adapter = onnx_asr.load_model("OpenVoiceOS/asr-uz-fastconformer-large-onnx")
    ts_adapter = adapter.with_timestamps()
    _ = ts_adapter.recognize(np.zeros(8000, dtype=np.float32), sample_rate=SAMPLE_RATE)
    print(f"Uzinfocom RNNT ready in {time.perf_counter() - t0:.2f}s", flush=True)

    app = web.Application(middlewares=[cors_middleware], client_max_size=10 * 1024 * 1024)
    app["ts_adapter"] = ts_adapter
    app["stt_lock"] = asyncio.Lock()
    app["tts_cache_dir"] = Path(__file__).resolve().parent.parent / "public" / "audio" / "cache"

    app.router.add_get("/api/health", handle_health)
    app.router.add_post("/api/stt", handle_stt)
    if os.environ.get("ALIFBO_DEV_TTS") == "1":
        app.router.add_get("/api/tts", handle_dev_tts)
    return app


if __name__ == "__main__":
    # Disable aiohttp access log to ensure no request details or paths are logged alongside audio activity.
    web.run_app(create_app(), host=HOST, port=PORT, access_log=None)
