# Testagram communication stack

Testagram keeps Supabase Auth, the native social graph, blocks and conversation membership authoritative. Matrix/Synapse and Novu are downstream infrastructure; Testagram's native media engine is the authoritative realtime media transport.

## Messaging

The browser uses the canonical communication boundary:

`MessagesPage -> communicationService -> capability-gateway -> capability_dispatch -> public.messages`

Conversation membership is enforced server-side. Message creation is idempotent through `client_message_id`, history is cursor-based, and realtime uses an authenticated Supabase Realtime subscription filtered by conversation.

The Matrix boundary is deliberately server-side. `src/services/matrixTransport.ts` can call a future Matrix bridge using the caller's Supabase JWT. Matrix access tokens, Application Service tokens and Synapse secrets must never be shipped to the browser.

For Synapse federation, the recommended mapping is one stable Matrix identity per Testagram user, provisioned through a server-side Application Service or Matrix Authentication Service integration. The mapping must be deterministic and must not depend on mutable display names.

## Calls

`MessagesPage -> testagram.calls.create/join -> Testagram Media Engine token -> native Pion/WebRTC SFU`

Testagram creates the call session and authorizes conversation membership before issuing a short-lived native media token. The browser receives only the room token and Testagram Media Engine WebSocket URL. The media-engine secret remains server-side.

The call surface uses the native Testagram media session so the Vite/React application owns the media client and does not depend on a third-party realtime media SDK. The interaction model includes participant tiles, permission-aware media controls, reconnect state and a dedicated call surface.

## MatrixRTC / Element Call pattern

Element Call remains a reference for federation-aware calling patterns. Testagram keeps its native conversation/call records authoritative and its own WebRTC media engine authoritative for transport; MatrixRTC signalling can be added behind the Matrix bridge without changing the Testagram identity plane.

## Notifications

Native Testagram notifications remain authoritative. Novu is downstream delivery/orchestration for push, email and other channels. No Novu API key belongs in the browser.

## Production secrets

Native media engine:

- `MEDIA_ENGINE_URL`
- `MEDIA_ENGINE_SECRET`
- `MEDIA_ENGINE_ICE_SERVERS`

Optional Matrix bridge:

- `MATRIX_HOMESERVER_URL`
- server-side Matrix Application Service or OIDC configuration

Novu worker:

- `NOVU_API_KEY`
- server-side Novu endpoint/workspace configuration

These secrets are intentionally not committed to the repository and are not required for the web build. Downstream providers should fail closed when unconfigured.
