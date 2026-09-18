FROM public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-51f83158a70a383f03a4d03dbd8b6ea102cf0361@sha256:253d7ed3409effa7fa59113d93b4b79bb731d8264cdaf4cd60294924d0110a2e
LABEL org.opencontainers.image.title="Repro Relay" \
      org.opencontainers.image.source="https://github.com/lusknchars/repro-relay" \
      org.opencontainers.image.licenses="MIT"
ENV AGENT_ID=repro-relay
COPY --chmod=0644 agent/runtime/persona.md /opt/hermes/plow-seed/persona.md
COPY agent/skills/ /opt/hermes/skills/
COPY agent/LICENSE agent/NOTICE /usr/share/doc/repro-relay/
COPY agent/vendor/ /usr/share/doc/repro-relay/vendor/
COPY agent/vendor/client.pin /opt/plow/agent-index-client.pin
RUN set -eu; \
    sha="$(sed -n 's/^sha=//p' /opt/plow/agent-index-client.pin)"; \
    want="$(sed -n 's/^sha256=//p' /opt/plow/agent-index-client.pin)"; \
    path="$(sed -n 's/^path=//p' /opt/plow/agent-index-client.pin)"; \
    curl -fsS --max-time 60 -o /opt/plow/agent-index-client.py \
      "https://raw.githubusercontent.com/plow-pbc/agent-index-client/${sha}/${path}"; \
    echo "$want  /opt/plow/agent-index-client.py" | sha256sum -c -; \
    chmod 0644 /opt/plow/agent-index-client.py; \
    find /opt/hermes/skills -type d -exec chmod 0755 {} +; \
    find /opt/hermes/skills -type f -exec chmod 0644 {} +
COPY agent/image/s6-overlay/ /etc/s6-overlay/
RUN chmod 0755 /etc/s6-overlay/s6-rc.d/agent-index/run /etc/s6-overlay/s6-rc.d/transport-watchdog/run
