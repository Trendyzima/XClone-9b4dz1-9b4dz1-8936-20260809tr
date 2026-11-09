# Native ad-review contract v1

The Flutter and web admin clients use Testagram Backend routes. They do not call Supabase RPCs or tables.

## Authentication and authorization

- The admin client establishes a short-lived Appwrite session.
- Appwrite session cookies are HttpOnly on web and stored in platform secure storage on native clients.
- The client obtains an Appwrite JWT and sends it as `Authorization: Bearer <jwt>` to Testagram Backend.
- Backend verifies the Appwrite account and current session, requires a second factor, and rejects MFA older than five minutes.
- A reviewer must be the configured platform owner or have an active `platform.ads` permission.
- The Appwrite endpoint and project ID are build-time public configuration; no Appwrite API key is shipped to clients.

## Backend routes

- `GET /api/admin/ads/review-queue?status=pending|approved|rejected|all&limit=200`
- `POST /api/admin/ads/{campaign_id}/review` with `{"decision":"approved"|"rejected","note":"..."}`
- `POST /api/admin/ads/{campaign_id}/status` with `{"status":"active"|"paused"}`
- `POST /api/admin/staff/permissions` with `{"user_id":"...","permission_key":"platform.ads","enabled":true|false}`

Rejection requires a reason of at most 500 characters. Approval never activates an unpaid campaign. Pause, resume, review and permission changes are audited server-side.

## Data migration boundary

The Backend migration creates the native advertiser, campaign, creative, permission and audit tables. Existing legacy campaigns must be imported and reconciled before the new queue is used as the production source of truth. The migration intentionally does not invent or discard legacy campaign records.
