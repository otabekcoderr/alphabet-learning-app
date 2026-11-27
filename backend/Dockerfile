FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
WORKDIR /app
RUN chown -R user:user /app

COPY --chown=user:user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

USER user

ENV HOME=/home/user \
    HF_HOME=/home/user/.cache/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PYTHONUNBUFFERED=1 \
    ALIFBO_HOST=0.0.0.0 \
    PORT=7860 \
    STT_MODEL_ID=OpenVoiceOS/asr-uz-fastconformer-large-onnx

# Pre-download the FastConformer ONNX weights as UID 1000 so cold starts do not wait on HF Hub downloads
RUN python -c "import os, onnx_asr; onnx_asr.load_model(os.environ['STT_MODEL_ID'])"

COPY --chown=user:user server.py .

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"7860\")}/health', timeout=5)"

CMD ["python", "server.py"]
