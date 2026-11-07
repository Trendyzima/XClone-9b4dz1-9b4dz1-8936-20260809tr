# XClone client contract for Neon and realtime

XClone is a presentation/client only. It must not connect directly to Neon PostgreSQL, Appwrite Databases, Federation PostgreSQL, Upstash or Cloudflare Durable Object bindings with privileged credentials.

## Authentication and API

- Appwrite SDK is used for account signup, login, session refresh and recovery.
- For application data, XClone sends the Appwrite session JWT to the single public Backend API.
- Backend verifies the session and owns profiles, posts, social graph, visibility, message authorization and canonical data.
- Do not use Appwrite Databases or Appwrite Realtime as the product data/realtime path after the Backend/Neon migration is complete.
- Never ship Neon URLs, Appwrite server API keys, Redis credentials, QStash tokens or realtime HMAC secrets in Vite variables.

## Realtime connection contract

1. XClone calls an authenticated Backend endpoint to request a conversation-scoped realtime ticket.
2. Backend verifies conversation membership and returns a short-lived ticket (maximum five minutes).
3. Because the browser WebSocket API cannot set Authorization headers, XClone opens `wss://realtime.testagram.site/v1/realtime/conversations/{conversation_id}` with subprotocols `["testagram.realtime.v1", "ticket." + ticket]`. The Worker validates the ticket and negotiates only `testagram.realtime.v1`; it must never echo the ticket subprotocol. Never put tickets in URL query parameters, log them, or persist them.
4. The WebSocket is receive-only for application events. XClone sends only ping frames.
5. Sending/editing/deleting messages remains a normal authenticated Backend API request with a stable client_message_id/idempotency key.
6. Backend commits the message to Neon and then publishes a signed event to Cloudflare Durable Objects.
7. On reconnect, XClone fetches missed messages from Backend using a cursor; the WebSocket is not a durable message store.

## Event envelope

Backend-published events use event_id, conversation_id, event_type, occurred_at and payload. Supported event types in the first transport version are message.created, message.updated, message.deleted and conversation.updated. Treat event payloads as untrusted display data and render text safely.

This contract is staged. Do not wire a production WebSocket URL until Backend ticket issuance, membership authorization, message APIs, signed publishing, Cloudflare deployment and cross-repository tests are complete.
