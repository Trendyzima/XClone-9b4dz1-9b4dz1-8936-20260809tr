# Testagram communication stack

Testagram keeps Supabase Auth, the native social graph, blocks and conversation membership authoritative. Matrix/Synapse, LiveKit and Novu are downstream infrastructure, not replacement identity or inbox systems.

## Messaging

The browser uses the canonical communication boundary:

`MessagesPage -> communicationService -> capability-gateway -> capability_dispatch -> public.messages`

Conversation membership is enforced server-side. Message creation is idempotent through `client_message_id`, history is cursor-based, and realtime uses an authenticated Supabase Realtime subscription filtered by conversation.

The Matrix boundary is deliberately server-side. `src/services/matrixTransport.ts` can call a future Matrix bridge using the caller's Supabase JWT. Matrix access tokens, Application Service tokens and Synapse secrets must never be shipped to the browser.

For Synapse federation, the recommended mapping is one stable Matrix identity per Testagram user, provisioned through a server-side Application Service or Matrix Authentication Service integration. The mapping must be deterministic and must not depend on mutable display names.

## Calls

`MessagesPage -> testagram.calls.create/join -> livekit-token -> LiveKit`

Testagram creates the call session and authorizes conversation membership before issuing a short-lived LiveKit JWT. The browser receives only the room token and LiveKit URL. LiveKit API credentials remain in Edge Function secrets.

The call surface uses the LiveKit JavaScript SDK directly so the existing Vite/React application does not need the complete Element Call application embedded. The interaction model follows the useful Element Call patterns: participant tiles, permission-aware media controls, reconnect state and a dedicated call surface.

## MatrixRTC / Element Call pattern

Element Call is a reference for a future federation-aware calling layer: Matrix supplies room/signalling semantics while LiveKit supplies the media SFU. Testagram currently keeps its native conversation/call records authoritative and can add MatrixRTC signalling behind the Matrix bridge without changing the Testagram identity plane.

## Notifications

Native Testagram notifications remain authoritative. Novu is downstream delivery/orchestration for push, email and other channels. No Novu API key belongs in the browser.

## Production secrets

LiveKit Edge Function:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Optional Matrix bridge:

- `MATRIX_HOMESERVER_URL`
- server-side Matrix Application Service or OIDC configuration

Novu worker:

- `NOVU_API_KEY`
- server-side Novu endpoint/workspace configuration

These secrets are intentionally not committed to the repository and are not required for the web build. Downstream providers should fail closed when unconfigured.
