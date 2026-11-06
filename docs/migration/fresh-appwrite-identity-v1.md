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
