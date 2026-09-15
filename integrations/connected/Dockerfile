FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates libopus0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.11.8
WORKDIR /opt/hermes
RUN git init . && git remote add origin https://github.com/NousResearch/hermes-agent.git \
    && git fetch --depth 1 origin 939e45c91d751fadd94dcd1b873ac3cb44846213 \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 939e45c91d751fadd94dcd1b873ac3cb44846213 \
    && uv sync --frozen --no-dev --python /usr/local/bin/python --extra sms --extra mcp --extra anthropic
WORKDIR /app
COPY integrations/ /app/integrations/
COPY web/src/lib/relay-tools.json /app/web/src/lib/relay-tools.json
ENV PATH="/opt/hermes/.venv/bin:$PATH"
USER 65532:65532
CMD ["python", "/app/integrations/connected/launch.py", "hermes"]
