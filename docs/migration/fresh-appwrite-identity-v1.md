# Fresh Appwrite identity migration — frontend contract

This branch adds the frontend's canonical identity API adapter without changing the live global auth provider.

## Target ownership

- Appwrite Auth owns credentials, email verification, recovery and browser sessions.
- Testagram Backend owns canonical UUIDs, account status, usernames and all authorization decisions.
- XClone receives a short-lived Appwrite JWT in memory and calls only the Testagram API for canonical identity.
- The browser never receives an Appwrite API key, PostgreSQL credential or service-role secret.

## New API client operations

`appwriteAuth.getCanonicalIdentity()` calls `GET /api/identity/session`.
`appwriteAuth.provisionCanonicalIdentity({ username, displayName, birthDate, policyVersion })` calls `POST /api/identity/provision` and sends explicit Terms, Privacy, Community Guidelines and age-confirmation flags. The Backend independently checks the adult birth date and records the acceptance in PostgreSQL in the same transaction as account creation.

Both use a fresh short-lived Appwrite JWT, omit cookies, disable redirects, and require a valid response containing a canonical UUID. The API's 409 response for an unlinked legacy account is not treated as permission to create a second account.

## Cutover is intentionally not enabled yet

The current application still contains legacy Supabase auth listeners, direct AuthPage flows, PostgREST/Realtime calls, RPCs and Edge Function dependencies. This PR does not replace those globally. Do not set `VITE_TESTAGRAM_AUTH_PROVIDER=appwrite` until the Appwrite session provider, verification/recovery routes, legal-consent persistence and all required feature adapters have been migrated and tested.

## Required sequence

1. Import a complete legacy account inventory into Backend's protected reservation table.
2. Verify every existing canonical UUID and dependent data domain.
3. Enable the migration inventory completion flag only after reconciliation.
4. Link existing accounts by simultaneous proof of the old and new sessions; never by matching email alone.
5. Provision genuinely new Appwrite users only after the inventory gate is complete.
6. Switch the XClone session provider in a staged release, with a rollback window.


## KYC attestation bridge

The existing private identity-verification engine remains the source of KYC decisions during this migration. The updated `identity-signup` Edge Function now exposes a server-side `bind_appwrite_identity` action. It:

1. Loads the registration intent using its one-time registration token.
2. Rechecks that the email OTP was verified, the identity state is approved, the engine decision is approved, the verified birth date matches and the national-ID fingerprint exists.
3. Verifies the supplied Appwrite JWT against the Appwrite Account endpoint and checks that the Appwrite email matches the approved registration email.
4. Calls the Backend's private `POST /internal/identity/approval` endpoint with a server-only ingest token and a stable provider event ID.

Before enabling `APPWRITE_KYC_BINDING_ENABLED`, deploy the updated Edge Function and configure these Supabase Function secrets (never Vite variables):

- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`
- `TESTAGRAM_BACKEND_URL` (the private or authenticated Backend API origin)
- `APPWRITE_IDENTITY_INGEST_TOKEN` (the exact high-entropy secret configured in the Backend secret store)

The Backend registration-status endpoint returns disabled until the KYC binding flag, Appwrite server configuration and PostgreSQL legacy inventory are all ready. The XClone signup UI checks that endpoint before starting KYC, so users are not sent through verification while account provisioning is intentionally closed.

Existing-account migration is separate: the user proves the old Supabase session and new Appwrite session; the Backend links them to the original canonical UUID. Do not import or copy password hashes.
