# Testagram communication stack

Testagram does not vendor or replace its identity/data plane with Synapse, LiveKit, Element Call, or Novu. Those projects are provider/infrastructure references behind the native capability plane.

## Authority

- **Identity:** Supabase Auth + `public.profiles`
- **Authorization:** Testagram conversation membership, blocks and moderation rules
- **DM source of truth:** `public.conversations`, `public.conversation_members`, `public.messages`
- **Notification source of truth:** `public.notifications`
- **Capability boundary:** `capability-gateway` → `public.capability_dispatch`

## Matrix / Synapse boundary

Synapse/Matrix is treated as the federation and interoperability adapter for messaging. A message written through `testagram.messages.send` first lands in native Testagram storage. `messages_enqueue_communication_delivery` writes a server-only Matrix delivery job to `communication_delivery_outbox`. `matrix-message-bridge` forwards those jobs to a configured Matrix bridge webhook.

This prevents Matrix from becoming a second Testagram identity system and lets the bridge be enabled only after a Matrix homeserver/appservice is configured.

## LiveKit boundary

`testagram.calls.create/join/end` owns the Testagram call lifecycle in `call_sessions` and `call_participants`. The `livekit-token` Edge Function verifies the authenticated caller is a member of the call's conversation, then mints a short-lived LiveKit room JWT using server-only `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.

The browser never receives the LiveKit API secret.

## Element Call / MatrixRTC

Element Call is used as an architectural reference for the MatrixRTC/LiveKit split, not copied into Testagram. A future MatrixRTC deployment can use the same Testagram call session as its authorization anchor while keeping the social graph and permissions native.

## Novu

Novu remains downstream of `public.notifications` and the existing notification delivery outbox. Message creation now produces a canonical `message.received` notification, so existing Novu delivery orchestration can deliver push/email/etc. without making Novu the authoritative inbox.

## Provider configuration

No provider secret is committed to the repository. The following are server-side configuration only:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `MATRIX_BRIDGE_WEBHOOK_URL`
- `MATRIX_BRIDGE_WEBHOOK_SECRET`
- existing `NOVU_API_KEY`

The provider adapters fail closed when their credentials are absent.
