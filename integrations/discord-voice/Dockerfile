FROM python:3.12-slim-bookworm
RUN pip install --no-cache-dir 'discord.py[voice]==2.7.1'
WORKDIR /app
COPY integrations/discord-voice /app/integrations/discord-voice
USER 65532:65532
ENTRYPOINT ["python", "/app/integrations/discord-voice/bot.py"]
