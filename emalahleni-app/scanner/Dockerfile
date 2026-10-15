# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
# Optional public CA secret supports the managed build proxy without embedding its trust file.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then printf 'Acquire::https::CaInfo "/run/secrets/proxy_ca";\n' > /etc/apt/apt.conf.d/99-task-proxy-ca; fi; \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates clamav-daemon clamav-freshclam tesseract-ocr tesseract-ocr-eng poppler-utils util-linux \
    && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99-task-proxy-ca \
    && groupadd --gid 10001 scanner && useradd --uid 10001 --gid 10001 --no-create-home scanner \
    && install -d -o scanner -g scanner -m 0700 /var/lib/clamav /run/clamav /app
WORKDIR /app
COPY --chown=scanner:scanner freshclam.conf ./
USER 10001:10001
# Cache public signatures separately from application code. Bump this value for a forced seed refresh.
ARG CLAMAV_SIGNATURE_REFRESH=2026-10-15
RUN --mount=type=secret,id=proxy_ca,uid=10001,gid=10001,mode=0400 \
    set -eu; \
    test -n "$CLAMAV_SIGNATURE_REFRESH"; \
    if [ -f /run/secrets/proxy_ca ]; then export CURL_CA_BUNDLE=/run/secrets/proxy_ca; fi; \
    sed '/^NotifyClamd[[:space:]]/d' /app/freshclam.conf > /tmp/freshclam-bootstrap.conf; \
    freshclam --config-file=/tmp/freshclam-bootstrap.conf --quiet; \
    (test -s /var/lib/clamav/main.cvd || test -s /var/lib/clamav/main.cld); \
    (test -s /var/lib/clamav/daily.cvd || test -s /var/lib/clamav/daily.cld); \
    rm /tmp/freshclam-bootstrap.conf
COPY --chown=scanner:scanner server.mjs start.mjs clamd.conf ./
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/node","/app/start.mjs"]
CMD []
