# Testagram Media Engine

> Production CI validates the Go module graph, unit tests, vet, binary build, and container build.

Self-hosted WebRTC SFU for Testagram TV.

The broadcaster publishes the Testagram production A/V program bus. The engine forwards RTP to authorized viewers and relays guest contribution tracks back to the host. Media packets are not persisted by this service; Supabase remains the control plane.

## Production topology

```
Testagram TV Studio
        │
        ▼
Supabase Auth + Media Token
        │
        ▼
Media Gateway / WebSocket
        │
        ▼
Testagram Media Engine (Pion SFU)
        ├── Host publisher
        ├── Guest ingress
        ├── Viewer fan-out
        ├── Presence
        ├── ICE/STUN/TURN
        └── Health + Prometheus metrics
```

## Required runtime configuration

- `MEDIA_ENGINE_SECRET` — private HMAC secret shared only with the token Edge Function.
- `MEDIA_ENGINE_URL` — public `wss://` URL returned to the browser by `testagram-media-token`.
- `MEDIA_ENGINE_PUBLIC_IP` — public address when the engine is behind 1:1 NAT.
- `MEDIA_ENGINE_ICE_SERVERS` — optional JSON array of STUN/TURN servers, including TURN credentials.
- `MEDIA_ENGINE_ALLOWED_ORIGINS` — comma-separated browser origins; leave empty only when the deployment is intentionally protected by another origin policy.
- `MEDIA_ENGINE_NODE_ID` — stable node/region identifier for observability.
- `MEDIA_ENGINE_MAX_VIEWERS` — per-room viewer cap (default 500).
- `MEDIA_ENGINE_MAX_GUESTS` — per-room guest cap (default 4).
- `MEDIA_ENGINE_CONNECTIONS_PER_MINUTE` — per-source connection admission limit (default 60).
- `MEDIA_ENGINE_UDP_MIN` / `MEDIA_ENGINE_UDP_MAX` — RTP/ICE UDP range (defaults 10000–20000).
- `PORT` — HTTP/WebSocket listener (default 8080).

## Network

Expose TCP 8080 (normally behind TLS) for WebSocket signaling and UDP 10000–20000 for WebRTC media. If clients can be behind restrictive NAT/firewalls, configure TURN and advertise it through `MEDIA_ENGINE_ICE_SERVERS`.

Pion provides the WebRTC protocol implementation; the Testagram layer owns authorization, room lifecycle, participant roles, presence, limits, and observability.

## Endpoints

- `GET /healthz` — liveness/health information.
- `GET /readyz` — readiness; returns non-2xx when the private media secret is absent.
- `GET /metrics` — Prometheus-compatible counters/gauges.
- `GET /ws?token=...` — authenticated WebSocket signaling.

## Scaling model

A single process is a room worker, not the global media cluster. Production horizontal scaling requires deterministic room placement/sticky routing so every participant in a room reaches the same SFU node. Large broadcasts should use relay/cascade nodes rather than putting an arbitrarily large audience on one worker.

The control plane should track node capacity and room ownership. A future gateway can route by `hash(stream_id) -> region -> node`, drain nodes before replacement, and move only new rooms during normal operation. Existing WebRTC rooms should remain pinned until they end or a controlled media migration is performed.

## Recording policy

The engine does not implement server-side recording. Testagram TV Studio records locally through the browser's `MediaRecorder` path, preserving the requirement that finished recordings do not enter Testagram media storage.

## Development

Run the Go test suite with:

```bash
go test ./...
```

Build the container with:

```bash
docker build -t testagram-media-engine ./media-engine
```


## Production deployment

This service requires a real public Linux host with UDP networking. Do not deploy the SFU itself to a serverless HTTP-only runtime.

The repository includes `docker-compose.yml` for the SFU + coturn. The CI workflow publishes the image to GHCR as `ghcr.io/trendyzima/testagram-media-engine`.

Generate secrets on the media host, never in source control:

```bash
export MEDIA_ENGINE_SECRET="$(openssl rand -hex 32)"
export TURN_PASSWORD="$(openssl rand -hex 24)"
```

Create `.env` on the host:

```dotenv
MEDIA_ENGINE_SECRET=<generated-secret>
MEDIA_ENGINE_PUBLIC_IP=<public-ip>
MEDIA_ENGINE_NODE_ID=native-1
MEDIA_ENGINE_ALLOWED_ORIGINS=https://<testagram-web-origin>
MEDIA_ENGINE_ICE_SERVERS=[{"urls":"stun:<turn-host>:3478"},{"urls":"turn:<turn-host>:3478?transport=udp","username":"<turn-user>","credential":"<turn-password>"},{"urls":"turns:<turn-host>:5349?transport=tcp","username":"<turn-user>","credential":"<turn-password>"}]
TURN_REALM=<turn-host>
TURN_USERNAME=<turn-user>
TURN_PASSWORD=<turn-password>
MEDIA_ENGINE_UDP_MIN=10000
MEDIA_ENGINE_UDP_MAX=20000
TURN_MIN_PORT=49152
TURN_MAX_PORT=65535
```

Open the firewall/security group for TCP 8080 (or only the TLS reverse-proxy listener), UDP 10000-20000 for the SFU, UDP/TCP 3478 and TCP/UDP 5349 as required for TURN, and the TURN relay range 49152-65535/UDP. Coturn documents 3478/5349 as listener ports and a configurable relay range; its Docker guidance recommends host networking for large UDP ranges. citeturn0search0turn0search1

Start:

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
curl -fsS http://127.0.0.1:8080/metrics
```

Then set the same `MEDIA_ENGINE_SECRET` and the public HTTP(S) origin of this engine in the Supabase Edge Function environment:

- `MEDIA_ENGINE_URL=https://<media-host>`
- `MEDIA_ENGINE_SECRET=<same-generated-secret>`
- `MEDIA_ENGINE_ICE_SERVERS=<same JSON array>`

The browser receives a WSS endpoint from `testagram-media-token`; RTP never traverses Supabase.

## Production acceptance gate

Do not mark migration complete on HTTP health alone. Capture one real broadcast and verify:

1. host WebRTC connection reaches `connected`/stable ICE;
2. engine `testagram_media_rtp_packets_total` increases continuously;
3. viewer receives both video and audio tracks;
4. guest contribution reaches the host;
5. forced host WebSocket/network interruption causes token refresh and reconnect;
6. forced viewer interruption reconnects without changing stream identity;
7. a TURN-only test produces a `relay` ICE candidate;
8. program track is 1920x1080 at the configured frame rate;
9. audio track is 48000 Hz;
10. `/metrics` shows no sustained RTP write errors;
11. the broadcast remains native `testagram-media://` and no Testagram native media engine endpoint is called.

Only after these checks pass should the old Testagram native media engine compatibility functions be considered permanently retired.
