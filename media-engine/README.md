# Testagram Media Engine

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
