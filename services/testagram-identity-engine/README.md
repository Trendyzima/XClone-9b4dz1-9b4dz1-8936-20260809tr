# Testagram Identity Engine

This is Testagram's identity-verification engine boundary. It is deliberately independent of any identity-verification vendor.

## Flow

1. Testagram creates a verification session.
2. The browser captures Kenyan national-ID front/back, selfie and a short liveness sequence.
3. Evidence is uploaded to the private `identity-evidence` bucket using short-lived signed upload credentials.
4. A self-hosted native worker reads the evidence and runs four local stages:
   - document quality + tamper analysis
   - OCR + field normalization
   - liveness analysis
   - face embedding/matching
5. The worker cross-validates front/back fields, age, and one-person-one-account fingerprint.
6. The worker signs one compact result and submits it to `identity-engine-result`.
7. Testagram, not the worker and not the browser, makes the final state transition.
8. Raw evidence is deleted after processing according to the retention policy; only the protected fingerprint, decision and audit metadata remain.

## Native deployment

The worker is designed to run directly on Linux under systemd. Docker is not part of the runtime architecture.

The repository intentionally exposes an engine adapter boundary so model implementations can be replaced without changing the account, database, or capture flow.

## Security rule

A browser can upload evidence and report progress, but it can never submit an approval decision. Only a server-side engine request carrying the configured engine secret and a valid HMAC can create an engine result.
