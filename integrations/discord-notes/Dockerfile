FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/speech && /opt/speech/bin/pip install --no-cache-dir faster-whisper==1.2.1
RUN /opt/speech/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-tiny', revision='d90ca5fe260221311c53c58e660288d3deb8d356', local_dir='/opt/whisper-tiny')"
WORKDIR /app/integrations/discord-notes
COPY integrations/discord-notes/package*.json ./
RUN npm ci --omit=dev
COPY integrations/discord-notes/ ./
ENV HF_HUB_OFFLINE=1
USER 65532:65532
CMD ["node", "bot.mjs"]
