# Testagram TV SRS media gateway

This service is the dedicated TV broadcast media plane. It does not replace the existing Pion media-engine used by Spaces/Calls.

## Flow

Browser TV Studio -> SRS WHIP -> SRS RTC-to-RTMP -> YouTube Live
                                         -> optional Mux RTMPS secondary

Testagram/Vercel remains the control plane. Supabase remains the canonical auth/database control plane. Cloudflare R2/DNS remains untouched by this TV media migration.

## Production host

Run this stack on a public Linux host with:

- TCP 80/443 for Caddy HTTPS.
- UDP 8000 for SRS WebRTC media.
- TCP 8000 for WebRTC-over-TCP fallback.
- Public DNS media.testagram.site pointing at the host.
- SRS_PUBLIC_IP set to the host's public IPv4.
- SRS_API_TOKEN set to the same secret configured in Vercel.
- Ports 1935/1985 remain internal; do not expose them publicly.

The WHIP endpoint is exposed through Caddy at:
https://media.testagram.site/rtc/v1/whip/

The Vercel control plane uses:
https://media.testagram.site/srs-api/streams

## Security model

The browser receives a short-lived opaque, AES-GCM encrypted SRS session token. It contains the stream ID, expiry, and downstream RTMP destination URLs. It is never persisted in Supabase.

SRS calls Vercel HTTP callbacks before accepting the publish and when creating dynamic RTMP forwards. The callback verifies the encrypted token and stream ID.

## Mux secondary path

Set TV_SECONDARY_DISTRIBUTION=mux in Vercel to create a disposable Mux Live Stream and have SRS forward the same program to both YouTube and Mux. Leave it empty to avoid the extra distribution path.

## Important

SRS is the TV media plane only. Do not point Spaces/Calls at this service.
