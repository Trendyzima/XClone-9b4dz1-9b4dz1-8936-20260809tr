# Testagram Media Engine

Self-hosted WebRTC SFU for Testagram TV.

The broadcaster publishes the Testagram production A/V bus. Viewers receive those tracks from the SFU. Media is not persisted. Supabase remains the control plane.

Required runtime secrets:
- MEDIA_ENGINE_SECRET
- MEDIA_ENGINE_PUBLIC_IP
- PORT (default 8080)

Expose TCP 8080 for TLS/WebSocket signaling and UDP 10000-20000 for WebRTC media.

This service intentionally runs outside Vercel because persistent WebRTC UDP/SFU workloads require a long-lived media host or cluster.
