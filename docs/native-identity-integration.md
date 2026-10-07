# Testagram native identity integration

Testagram uses the operator-owned Idswyft Community fork as its identity verification engine.

Runtime contract:
- IDSWYFT_BASE_URL: URL of the self-hosted Idswyft API.
- IDSWYFT_API_KEY: secret API key stored only in Supabase Edge Function secrets.
- IDSWYFT_WEBHOOK_SECRET: shared HMAC secret stored only in Supabase Edge Function secrets and the Idswyft host.
- IDENTITY_PREAUTH_SECRET: Testagram-only HMAC key for protected identity fingerprints.

The browser never receives IDSWYFT_API_KEY or IDSWYFT_WEBHOOK_SECRET.

Flow:
1. identity-signup creates a pending signup intent and verifies email.
2. create_identity_session calls the self-hosted Idswyft /api/v2/verify/initialize endpoint with national_id + identity mode.
3. Idswyft returns verification_id, session_token and verification_url.
4. Testagram redirects the user to the self-hosted verification page.
5. Idswyft performs front ID OCR, back ID/barcode processing, cross-validation, liveness and face match.
6. Idswyft sends a signed webhook to idswyft-identity-webhook.
7. Testagram verifies the HMAC signature, checks Kenyan ID/DOB/liveness/face-match gates and writes only the protected fingerprint/minimum identity result.
8. finalize can create the Testagram account only after identity approval.

No Didit runtime credential is required by this flow.
