"""Modal serverless deployment for Alifbo's Uzinfocom FastConformer ONNX STT server."""

import asyncio
import base64
import sys
import time
from pathlib import Path

import modal

STT_MODEL_ID = "OpenVoiceOS/asr-uz-fastconformer-large-onnx"
MAX_AUDIO_BYTES = 10 * 1024 * 1024
SERVER_PY_PATH = Path(__file__).resolve().parent / "server.py"

app = modal.App("alifbo-stt")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1", "ca-certificates")
    .pip_install(
        "fastapi>=0.115.0",
        "python-multipart>=0.0.9",
        "aiohttp>=3.10.0,<4",
        "numpy>=1.26.0,<3",
        "onnx-asr[cpu,hub]>=0.12.0",
    )
    .env(
        {
            "HF_HOME": "/root/.cache/huggingface",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "PYTHONUNBUFFERED": "1",
            "STT_MODEL_ID": STT_MODEL_ID,
        }
    )
    .run_commands(
        'python -c "import os, onnx_asr; onnx_asr.load_model(os.environ[\'STT_MODEL_ID\'])"'
    )
    .add_local_file(str(SERVER_PY_PATH), remote_path="/root/server.py")
)


@app.cls(
    image=image,
    cpu=2.0,
    memory=2048,
    scaledown_window=180,
    max_containers=4,
    enable_memory_snapshot=True,
)
@modal.concurrent(max_inputs=8)
class AlifboSttService:
    @modal.enter(snap=True)
    def load_model(self) -> None:
        import numpy as np
        import onnx_asr

        if "/root" not in sys.path:
            sys.path.insert(0, "/root")
        import server

        self.server = server
        self.model_ready = False
        adapter = onnx_asr.load_model(STT_MODEL_ID)
        ts_adapter = adapter.with_timestamps()
        _ = ts_adapter.recognize(np.zeros(8000, dtype=np.float32), sample_rate=server.SAMPLE_RATE)
        self.ts_adapter = ts_adapter
        self.model_ready = True

    @modal.asgi_app(label="alifbo-stt")
    def web_app(self):
        from starlette.applications import Starlette
        from starlette.middleware import Middleware
        from starlette.middleware.cors import CORSMiddleware
        from starlette.responses import JSONResponse
        from starlette.routing import Route

        stt_lock = asyncio.Lock()
        app_ctx = {"ts_adapter": self.ts_adapter}

        async def health(request):
            if not getattr(self, "model_ready", False) or getattr(self, "ts_adapter", None) is None:
                return JSONResponse(
                    {
                        "ok": False,
                        "status": "loading",
                        "model": "uzinfocom-rnnt",
                        "model_id": STT_MODEL_ID,
                    },
                    status_code=503,
                )
            return JSONResponse(
                {
                    "ok": True,
                    "model": "uzinfocom-rnnt",
                    "model_id": STT_MODEL_ID,
                    "status": "ready",
                }
            )

        async def stt(request):
            expected = request.query_params.get("expected") or request.headers.get("X-Expected", "")
            accept_raw = request.query_params.get("accept") or request.headers.get("X-Accept", "")
            content_type = (request.headers.get("content-type") or "").lower()

            raw_bytes = b""
            if "application/json" in content_type:
                try:
                    payload = await request.json()
                except Exception:
                    return JSONResponse({"ok": False, "error": "Noto'g'ri JSON formati"}, status_code=400)
                if isinstance(payload, dict):
                    expected = str(payload.get("expected", expected) or "")
                    accept_raw = str(payload.get("accept", accept_raw) or "")
                    audio_b64 = str(payload.get("audio_base64", "") or "")
                    try:
                        raw_bytes = base64.b64decode(audio_b64)
                    except Exception:
                        return JSONResponse({"ok": False, "error": "Noto'g'ri base64 audio"}, status_code=400)
            elif "multipart/form-data" in content_type:
                form = await request.form()
                file_part = form.get("file") or form.get("audio")
                if file_part is not None and hasattr(file_part, "read"):
                    raw_bytes = await file_part.read()
                if not expected and isinstance(form.get("expected"), str):
                    expected = str(form.get("expected"))
                if not accept_raw and isinstance(form.get("accept"), str):
                    accept_raw = str(form.get("accept"))
            else:
                raw_bytes = await request.body()

            if not raw_bytes:
                return JSONResponse({"ok": False, "error": "Bo'sh audio yuborildi"}, status_code=400)
            if len(raw_bytes) > MAX_AUDIO_BYTES:
                return JSONResponse({"ok": False, "error": "Audio hajmi juda katta"}, status_code=413)

            try:
                wav = self.server.decode_audio_to_float32(raw_bytes)
            except Exception as exc:
                return JSONResponse({"ok": False, "error": f"Audio o'qilmadi: {exc}"}, status_code=400)

            trimmed, has_speech, info = self.server.trim_silence(wav)
            t0 = time.perf_counter()

            if not has_speech or len(trimmed) < 800:
                return JSONResponse(
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

            async with stt_lock:
                transcript, confidence, confidence_available = await asyncio.to_thread(
                    self.server.recognize_utterance,
                    app_ctx,
                    trimmed,
                    expected,
                    accept_raw,
                )

            latency_ms = round((time.perf_counter() - t0) * 1000)
            is_silence = False
            accepted = self.server.evaluate_match(expected, accept_raw, transcript, is_silence)

            return JSONResponse(
                {
                    "ok": True,
                    "transcript": transcript,
                    "normalized": self.server.normalize_uzbek(transcript),
                    "accepted": accepted,
                    "is_silence": is_silence,
                    "confidence": confidence,
                    "confidence_available": confidence_available,
                    "latency_ms": latency_ms,
                    "orig_ms": info["orig_ms"],
                    "trimmed_ms": info["trimmed_ms"],
                }
            )

        return Starlette(
            routes=[
                Route("/", health, methods=["GET"]),
                Route("/health", health, methods=["GET"]),
                Route("/api/health", health, methods=["GET"]),
                Route("/api/stt", stt, methods=["POST"]),
            ],
            middleware=[
                Middleware(
                    CORSMiddleware,
                    allow_origins=["*"],
                    allow_methods=["GET", "POST", "OPTIONS"],
                    allow_headers=["Content-Type", "X-Expected", "X-Accept"],
                )
            ],
        )
