# Testagram Mail

First-party transactional email service inspired by the useful API patterns in the Resend Node SDK, but independently implemented and owned by Testagram.

## API

- `GET /health`
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