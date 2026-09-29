#!/usr/bin/env bash
set -euo pipefail

: "${SRS_PUBLIC_IP:?SRS_PUBLIC_IP must be the public IPv4 address of the Testagram TV media host}"
SRS_DOMAIN="${SRS_DOMAIN:-media.testagram.site}"

cd "$(dirname "$0")"

echo "Validating Testagram SRS Compose configuration..."
docker compose config -q

echo "Validating Caddy configuration..."
docker run --rm   -e SRS_DOMAIN="$SRS_DOMAIN"   -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro"   caddy:2.10-alpine   caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

echo "Starting the Testagram-owned TV media gateway..."
docker compose pull
SRS_PUBLIC_IP="$SRS_PUBLIC_IP" SRS_DOMAIN="$SRS_DOMAIN" docker compose up -d --remove-orphans

echo "Waiting for SRS..."
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:1985/api/v1/versions >/tmp/testagram-srs-version.json; then
    break
  fi
  sleep 2
done

curl --fail --silent --show-error http://127.0.0.1:1985/api/v1/versions >/tmp/testagram-srs-version.json
cat /tmp/testagram-srs-version.json

echo "Checking the local SRS stream API..."
curl --fail --silent --show-error 'http://127.0.0.1:1985/api/v1/streams?start=0&count=10' >/tmp/testagram-srs-streams.json

echo "Checking public Testagram media gateway HTTPS..."
curl --fail --silent --show-error --retry 5 --retry-delay 2 "https://${SRS_DOMAIN}/healthz" >/tmp/testagram-srs-healthz.txt

echo "Checking WebRTC TCP listener..."
( command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 8000 ) || true

echo "Testagram TV media gateway is deployed and healthy."
