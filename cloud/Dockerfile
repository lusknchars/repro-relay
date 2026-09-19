FROM public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-ef0019372ff8bca593611b31ebd2e08f9f1458ff@sha256:a8a2f97ad78b8192d80a984dce81d3bf5a9a883d18cb7b677704913a09b56aee
LABEL org.opencontainers.image.title="Repro Relay" \
      org.opencontainers.image.source="https://github.com/lusknchars/repro-relay" \
      org.opencontainers.image.licenses="MIT"
ENV AGENT_ID=repro-relay
COPY --chmod=0644 agent/runtime/persona.md /opt/hermes/plow-seed/persona.md
COPY agent/skills/ /opt/hermes/skills/
COPY agent/LICENSE agent/NOTICE /usr/share/doc/repro-relay/
COPY agent/vendor/ /usr/share/doc/repro-relay/vendor/
RUN set -eu; \
    find /opt/hermes/skills -type d -exec chmod 0755 {} +; \
    find /opt/hermes/skills -type f -exec chmod 0644 {} +
COPY agent/image/s6-overlay/ /etc/s6-overlay/
RUN chmod 0755 /etc/s6-overlay/s6-rc.d/transport-watchdog/run
