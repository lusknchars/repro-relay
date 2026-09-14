FROM node:24-bookworm-slim AS frontend
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm ci --prefix reptest
RUN npm run build

FROM rust:1.98-bookworm AS backend
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY web/src-tauri/Cargo.toml web/src-tauri/Cargo.toml
COPY web/src-tauri/src/ web/src-tauri/src/
COPY web/src-tauri/build.rs web/src-tauri/build.rs
RUN cargo build --locked --release -p relay-api

FROM debian:bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/lusknchars/repro-relay"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /build/target/release/relay-api /app/relay-api
COPY --from=frontend /build/web/dist /app/web/dist
COPY integrations/ /app/integrations/
COPY relay /app/relay
RUN mkdir -p /app/.data && chown 65532:65532 /app/.data
ENV REPRO_MODE=guest
ENV PORT=8080
USER 65532:65532
EXPOSE 8080
CMD ["/app/relay-api"]
