# Testagram TV SRS media gateway

This is Testagram's dedicated TV media plane. It does not replace the existing Pion media-engine used by Spaces/Calls.

## Flow

Browser TV Studio -> SRS WHIP -> SRS RTC-to-RTMP -> YouTube Live

Testagram/Vercel remains the TV control plane. Supabase remains the canonical auth/database control plane. The TV media path is self-hosted SRS and has no external media-provider dependency.

## Self-contained design

SRS does **not** require an SRS vendor account, API subscription, or SRS API credential.

- The SRS HTTP API is private to the Docker network and is not used by Testagram's broadcast control path.
- Testagram does not call the SRS HTTP API for broadcast verification.
- WHIP authentication uses a short-lived encrypted Testagram session token in the WHIP URL.
- SRS calls Testagram's own HTTPS callbacks for publish authorization and dynamic forwarding.
- The YouTube destination URL and stream key are resolved server-side by Testagram. They are **not** embedded in the browser token.

The media host needs a public DNS name and its public IPv4 as SRS_PUBLIC_IP so WebRTC candidates are routable.

## Production host

This stack is deployed automatically by Testagram's production reconciliation onto the same managed media host as the native Pion engine. The native Testagram Caddy instance owns TCP 80/443 and routes only the TV hostname to this SRS container.

- UDP 8000 and TCP 8000 belong to the SRS container for WebRTC media.
- Public DNS `tv-media.testagram.site` points at the Testagram media host.
- `SRS_PUBLIC_IP` is the host's public IPv4 used in WebRTC candidates.
- SRS ports 1935/1985 are container-internal and are not published publicly.
- The SRS container joins the running Testagram media Docker network.
- The native Caddy stack remains the HTTPS edge for Spaces/Calls and TV.

The WHIP endpoint is:
`https://tv-media.testagram.site/rtc/v1/whip/`

## Security model

The browser receives a short-lived opaque AES-GCM token containing only the canonical stream ID and expiry. It is never persisted in Supabase.

SRS sends the token back to Testagram's `on_publish` and dynamic `on_forward` callbacks. Testagram decrypts and validates it, confirms the stream exists, and resolves the downstream RTMP/RTMPS destinations from the server-side control plane.

## Important

SRS is the TV media plane only. Do not point Spaces/Calls at this service.
