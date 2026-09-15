FROM public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-8088c7f77f5ffd536a80c9dc302ebdb39e6be1d2@sha256:26d69e81faebc584a4d819f68f756e2d4917938409b0f8ff98488c93bdd34b78
LABEL org.opencontainers.image.title="Repro Relay" \
      org.opencontainers.image.source="https://github.com/lusknchars/repro-relay" \
      org.opencontainers.image.licenses="MIT"
ENV AGENT_ID=repro-relay
COPY --chmod=0644 runtime/persona.md /opt/hermes/plow-seed/persona.md
COPY skills/ /opt/hermes/skills/
COPY LICENSE NOTICE /usr/share/doc/repro-relay/
COPY vendor/ /usr/share/doc/repro-relay/vendor/
COPY vendor/client.pin /opt/plow/agent-index-client.pin
RUN set -eu; \
    sha="$(sed -n 's/^sha=//p' /opt/plow/agent-index-client.pin)"; \
    want="$(sed -n 's/^sha256=//p' /opt/plow/agent-index-client.pin)"; \
    path="$(sed -n 's/^path=//p' /opt/plow/agent-index-client.pin)"; \
    curl -fsS --max-time 60 -o /opt/plow/agent-index-client.py \
      "https://raw.githubusercontent.com/plow-pbc/agent-index-client/${sha}/${path}"; \
    echo "$want  /opt/plow/agent-index-client.py" | sha256sum -c -; \
    chmod 0644 /opt/plow/agent-index-client.py; \
    find /opt/hermes/skills/relay-reach -type d -exec chmod 0755 {} +; \
    find /opt/hermes/skills/relay-reach -type f -exec chmod 0644 {} +
COPY image/s6-overlay/ /etc/s6-overlay/
RUN chmod 0755 /etc/s6-overlay/s6-rc.d/agent-index/run
