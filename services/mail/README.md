# Testagram Mail

First-party transactional email service inspired by the useful API patterns in the Resend Node SDK, but independently implemented and owned by Testagram.

## Authentication integration

Supabase authentication Edge Functions enqueue messages directly into the private
`public.mail_messages` table using server-side credentials and an idempotency key.
The local `services/mail` worker polls that table and performs SMTP delivery with
the existing retry/backoff policy. Authentication does **not** depend on
`mail.testagram.site`, a public mail-origin IP, an Nginx route, or a mail-gateway
Bearer token. The HTTP API remains available for internal integrations, but is not
on the sign-in, OTP, magic-link, password-recovery, or security-email critical path.

The local worker must run with valid `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
SMTP/DKIM configuration. `/health` and `/ready` remain diagnostics for the worker;
they are not used as a remote authentication deployment gate.

## API

- `GET /health` (liveness only)
- `GET /ready` (checks configuration, database access, and authenticated SMTP relay readiness)
- `POST /emails`
- `GET /emails/:id`
- `DELETE /emails/:id`

Authentication is a server-side Bearer token. `Idempotency-Key` makes retries safe.

Delivery is queued in PostgreSQL and processed by a worker. The worker supports:
- direct-to-recipient MX delivery (`TESTAGRAM_MAIL_DIRECT_SMTP=true`)
- authenticated SMTP relay fallback
- exponential retries
- persistent status/error tracking.

Do not put the mail token in Vite/browser variables.

### Direct delivery production requirements

Configure SPF, DKIM and DMARC for `testagram.site`, ensure the server has stable reverse DNS/hostname, and confirm outbound TCP/25 is permitted. Direct delivery without correct DNS/reputation will not provide reliable inbox placement.

### Relay mode

Set `TESTAGRAM_MAIL_SMTP_HOST`, `TESTAGRAM_MAIL_SMTP_PORT`, `TESTAGRAM_MAIL_SMTP_USER`, `TESTAGRAM_MAIL_SMTP_PASS`, and `TESTAGRAM_MAIL_SMTP_SECURE=true|false`.

The relay is transport only; Testagram owns the API, queue, database records, retries and application semantics.