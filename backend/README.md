---
title: Alifbo Uzbek FastConformer STT
emoji: 🦊
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# Alifbo Uzbek FastConformer STT

In-memory Uzbek speech recognition server for the **Alifbo** reading app, powered by `onnx-asr` and the **OpenVoiceOS/asr-uz-fastconformer-large-onnx** (Uzinfocom FastConformer RNNT) model.

## Endpoints

- `GET /health` and `GET /api/health` — returns `200 OK` (`{"ok": true, "status": "ready", ...}`) once the FastConformer ONNX model is loaded and warmed up (or `503` while loading).
- `POST /api/stt` — accepts raw audio (`audio/wav`, `audio/webm`, `audio/ogg`, `audio/mpeg`), `multipart/form-data` (`file`), or `application/json` (`audio_base64`) with optional `expected` and `accept` query/form fields.

## Privacy & Runtime

- Audio is decoded and transcribed strictly in memory with zero disk writes and zero transcript logging.
- Listens on `PORT` (`7860` on Hugging Face Spaces, `8765` locally via `ALIFBO_PORT`).
