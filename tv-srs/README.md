# Testagram TV SRS media gateway

This is Testagram's dedicated TV media plane. It does not replace the existing Pion media-engine used by Spaces/Calls.

## Flow

Browser TV Studio -> SRS WHIP -> SRS RTC-to-RTMP -> YouTube Live
                                         -> optional Mux RTMPS secondary

Testagram/Vercel remains the control plane. Supabase remains the canonical auth/database control plane. Cloudflare R2/DNS/backend paths remain untouched.

## Self-contained design

SRS does **not** require an SRS vendor account, API subscription, or SRS API credential.

- The SRS HTTP API is private to the Docker network and is not used by Testagram's broadcast control path.
- Testagram does not call the SRS HTTP API for broadcast verification.
- WHIP authentication uses a short-lived encrypted Testagram session token in the WHIP URL.
- SRS calls Testagram's own HTTPS callbacks for publish authorization and dynamic forwarding.
- Downstream YouTube/Mux destination URLs and stream keys are resolved server-side by Testagram. They are **not** embedded in the browser token.

The media host needs a public DNS name and its public IPv4 as SRS_PUBLIC_IP so WebRTC candidates are routable.

## Production host

Run this stack on a public Linux host with:

- TCP 80/443 for Caddy HTTPS.
- UDP 8000 for SRS WebRTC media.
- TCP 8000 for WebRTC-over-TCP fallback.
- Public DNS `tv-media.testagram.site` pointing at the host.
- Set `SRS_PUBLIC_IP` to the host's public IPv4 address before `docker compose up -d`.
- Ports 1935/1985 remain internal; do not expose them publicly.

The WHIP endpoint is:
`https://tv-media.testagram.site/rtc/v1/whip/`

## Security model

The browser receives a short-lived opaque AES-GCM token containing only the canonical stream ID and expiry. It is never persisted in Supabase.

SRS sends the token back to Testagram's `on_publish` and dynamic `on_forward` callbacks. Testagram decrypts and validates it, confirms the stream exists, and resolves the downstream RTMP/RTMPS destinations from the server-side control plane.

## Mux secondary path

Set `TV_SECONDARY_DISTRIBUTION=mux` to create a disposable Mux Live Stream and have SRS forward the same program to both YouTube and Mux. Leave it empty for YouTube-only distribution.

## Important

SRS is the TV media plane only. Do not point Spaces/Calls at this service.
