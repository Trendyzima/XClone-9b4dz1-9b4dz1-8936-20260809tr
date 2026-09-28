# Testagram TV Go Live — Cloudflare Stream + Supabase

TV Go Live uses Cloudflare Stream WebRTC for media transport. No VPS, Pion SFU host, TURN server, or self-managed media server is required.

## Runtime

- Browser: native WebRTC camera/microphone capture.
- Supabase Edge Function: authenticates the broadcaster and creates a Cloudflare Stream Live Input.
- Cloudflare Stream: receives WHIP and serves WHEP playback.
- Supabase Postgres: stores the Testagram live stream state and playback endpoint.
- Cloudflare Stream WebRTC recording is disabled for these live inputs.

## Required Supabase Edge Function secrets

Set these production secrets in Supabase Edge Functions:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_STREAM_ALLOWED_ORIGINS` (optional JSON array or comma-separated origins)

The Cloudflare token needs Account -> Stream -> Write permission scoped to the Testagram Cloudflare account.

Do not commit the token or put it in browser code.

## Cloudflare setup

1. Enable Cloudflare Stream/WebRTC for the account.
2. Copy the Cloudflare Account ID.
3. Create an API token with only the Stream Write permission required by the function.
4. Add the two secrets above to Supabase Edge Function Secrets.
5. Optionally set `CLOUDFLARE_STREAM_ALLOWED_ORIGINS` to the production Testagram origin.

The function creates a unique Live Input for each Testagram TV broadcast. Cloudflare returns:
- a secret WHIP publish URL for the broadcaster;
- a WHEP playback URL for viewers.

Only the WHEP URL is persisted to `live_streams.stream_url`, and only after the broadcaster has successfully negotiated WebRTC and transmitted both audio and video RTP.

## Go Live acceptance gate

The TV Studio sequence is:

1. Prepare the production program.
2. Create a non-live `live_streams` row.
3. Supabase authorizes the host and creates the Cloudflare Live Input.
4. Browser negotiates WHIP with Cloudflare.
5. WebRTC connection and ICE become ready.
6. Browser stats prove outbound video and audio packets/bytes are flowing.
7. Only then does Testagram set `live_streams.is_live = true` and publish the WHEP playback URL.
8. Viewer negotiates WHEP and receives the live video/audio.
9. Stop closes the WHEP/WHIP session and Testagram marks the stream ended.

## Important Cloudflare WebRTC characteristics

Cloudflare Stream WebRTC is intended for one-to-many live broadcasts. The current implementation therefore supports one TV publisher per Live Input. The previous native Pion guest-publishing path is not used by TV Go Live.

Cloudflare's current WebRTC documentation states that WebRTC live delivery is sub-second latency and has no fixed concurrent-viewer limit, while WebRTC live input currently does not provide live viewer-count metrics. Testagram therefore keeps its own viewer count using the `stream_viewers` table.

## Troubleshooting

- `CLOUDFLARE_STREAM_NOT_CONFIGURED`: one or both Cloudflare secrets are missing in Supabase.
- `CLOUDFLARE_STREAM_CREATE_FAILED`: the token/account/Stream entitlement or API request failed.
- `Cloudflare Stream WebRTC negotiation failed`: WHIP endpoint rejected the SDP or the browser/network could not establish WebRTC.
- `Media transport did not become ready`: WebRTC connected incompletely or RTP did not flow; inspect browser WebRTC diagnostics.
- `STREAM_PLAYBACK_NOT_READY`: the broadcast has not reached the ON AIR state and therefore has not published its WHEP endpoint.
