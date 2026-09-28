# Testagram TV 100K media architecture

Testagram TV keeps the existing Studio UI and moves the media path behind it.

## Production topology

- **Vercel + Supabase:** authentication, broadcast ownership, lifecycle, chat writes, moderation and social metadata.
- **Cloudflare Stream WebRTC ingest:** the Studio's already-composited program bus is published directly from the browser.
- **Cloudflare Stream HLS/DASH:** passive viewers receive the program through Cloudflare's global delivery network.
- **Cloudflare Realtime SFU:** reserved for the interactive production layer (host/guest/caller WebRTC). It is not used for the passive audience.

Cloudflare Stream's live HLS/DASH path requires a live input with recording/live playback enabled. The implementation therefore creates/reuses live inputs with automatic live playback and stores the HLS manifest locator in `live_streams.stream_url`. The browser publisher still uses the Stream WHIP endpoint; ON AIR is only committed after browser RTP diagnostics and Cloudflare's input lifecycle both pass.

## Why the viewer path is different

A passive viewer must never create a WebRTC SFU session. The viewer page:

1. reads the HLS manifest locator from `live_streams.stream_url`;
2. uses HLS.js where MediaSource is available;
3. falls back to native HLS where the browser provides it;
4. keeps chat/reactions separate from the video transport.

This prevents Vercel and Supabase from becoming a video relay.

## Chat fan-out

The old viewer page polled `stream_chat` every three seconds. That is incompatible with a large audience because 100,000 viewers would create tens of thousands of database requests per second.

The production path now uses Supabase Realtime Broadcast from a Postgres trigger:

`stream_chat INSERT` -> `realtime.send` -> `tv:<stream_id>:chat` -> connected Testagram viewers.

The broadcast payload contains the message plus the author's public display metadata, so viewers do not issue an additional profile query for every message.

## Required Vercel environment

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_STREAM_ALLOWED_ORIGINS`

The production reconciliation workflow synchronizes the server credentials from GitHub production secrets/variables. The Stream customer hostname is derived from the WHIP URL returned by Cloudflare, so no customer-code secret is required. Never put the API token or account credentials in browser code.

## Important capacity boundary

This architecture is designed for a **100,000+ passive-viewer topology**, but it is not a promise of a free 100,000-viewer workload. Cloudflare Stream delivery is usage-priced. Realtime SFU has a separate shared free egress allowance. The application should therefore treat audience scale and provider cost as separate controls.

The Studio frontend layout is intentionally unchanged. The media implementation is behind the existing video elements and the existing Go Live state machine.
