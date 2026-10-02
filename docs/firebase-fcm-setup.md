# Testagram Firebase FCM setup

## Canonical project

The Android application currently uses the Firebase project declared by `android/app/google-services.json`.

The FCM server credential MUST belong to the same Firebase project.

## GitHub Actions secret

Create this repository secret:

- Name: `FIREBASE_SERVICE_ACCOUNT_JSON`
- Value: the complete Firebase service-account JSON for the canonical project.

Never commit the real JSON file. Never place the private key in source code, issues, pull requests, logs, or chat.

## Supabase Edge Functions

The production reconciliation workflow synchronizes `FIREBASE_SERVICE_ACCOUNT_JSON` into the Supabase Edge Function secret named `FIREBASE_SERVICE_ACCOUNT_JSON` and deploys the notification functions.

The FCM worker also supports the existing Vault fallback `firebase_service_account_json`.

## Project consistency check

The worker validates the service account `project_id` against `FIREBASE_PROJECT_ID`. A mismatched Firebase credential fails closed instead of sending notifications to the wrong Firebase project.

## Local development

Copy `config/firebase-service-account.example.json` to a local-only file if needed, replace the placeholders, and keep the real file outside Git.

Recommended environment variables:

```
FIREBASE_SERVICE_ACCOUNT_JSON=<complete JSON value>
FIREBASE_PROJECT_ID=<canonical project id>
```
