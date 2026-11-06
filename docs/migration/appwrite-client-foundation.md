# Appwrite frontend client foundation

The official Appwrite Web SDK is now installed with a small isolated adapter in `src/lib/appwrite.ts` and `src/services/appwriteAuth.ts`.

Supported adapter operations:

- Email/password signup and login.
- Current Appwrite account lookup.
- Email verification request and completion.
- Password recovery request and completion.
- Short-lived Appwrite JWT creation for authenticated Go API requests.
- Logout and in-memory JWT cache invalidation.

## Configuration

Set the frontend build variables:

- `VITE_APPWRITE_ENDPOINT`: owned HTTPS Appwrite API endpoint ending in `/v1`.
- `VITE_APPWRITE_PROJECT_ID`: Appwrite project ID.

HTTP is accepted only for localhost development. Do not place Appwrite API keys, API secrets or service credentials in `VITE_*` variables. Configure the production and staging frontend platforms as allowed Appwrite platforms. Prefer an owned Appwrite custom domain for browser cookie/session reliability.

## Not a production auth cutover

The adapter is intentionally not wired into `AuthProvider`, `AuthPage`, or the current global session store. The frontend still has broad direct Supabase Auth/PostgREST/Realtime/Edge Function dependencies. Switching the auth issuer before those domain APIs and account linking are ready would strand users or leave many screens unauthenticated.

The backend Appwrite verifier accepts only explicitly linked identities. It returns HTTP 409 for an unlinked Appwrite account and never creates a random Testagram UUID during login. The next backend milestone must add a dual-session existing-account linking flow (verified legacy Supabase session plus Appwrite session) and a transactional new-account provisioning flow that creates the canonical PostgreSQL account and Appwrite identity mapping together. Email equality alone is not proof of account ownership.

Do not set `TESTAGRAM_AUTH_PROVIDER=appwrite` in production until the backend identity-link/provision APIs, all required Go API authorization paths, frontend session integration, account recovery and staging migration tests pass.
