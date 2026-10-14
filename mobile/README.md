# Testagram Flutter clients

This directory contains the shared Flutter application compiled for **Flutter Web** and **native Android**. It is a migration foundation, not yet a claim of full feature parity. The production React/Vite website and existing Android WebView release remain the fallback until the parity inventory is complete and the release gates pass.

## Run locally

Install the stable Flutter SDK, then:

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
flutter run -d chrome --dart-define=SUPABASE_URL=https://YOUR_PROJECT.supabase.co --dart-define=SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
flutter run -d android --flavor production --dart-define=SUPABASE_URL=https://YOUR_PROJECT.supabase.co --dart-define=SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

The app intentionally shows a setup screen if build-time configuration is absent. Never put service-role keys, database passwords, signing credentials, or other privileged secrets in Dart source, assets, `--dart-define` values committed to Git, or web bundles. A Supabase publishable key is public; authorization must be enforced by RLS and server-side capabilities.

## Preserve the original product

- `lib/core/theme/testagram_theme.dart` contains the green/black palette and surface tokens sampled from the existing Testagram CSS.
- `lib/core/widgets/testagram_background.dart` recreates the subtle green light bloom and fine-grain texture without remote assets.
- The original Testagram logo is used for the Flutter launcher and web icons.
- Responsive navigation uses a bottom bar on phones and a navigation rail on wide layouts.
- Existing backend projects, account records, storage objects, policies, APIs and business rules remain the source of truth.

## Security and sessions

- Auth uses Supabase PKCE.
- `TestagramSessionStorage` uses Android secure storage and browser storage on Flutter Web.
- `SessionPolicy` and `SessionGuard` enforce a maximum 24-hour session age without resetting the clock on refresh-token rotation, including while the app remains open.
- The existing 18+ legal gate and `accept_testagram_legal` RPC are retained; native login must not bypass legal acceptance.
- Encrypted messaging is deliberately not written directly to the `messages` table. It stays behind the existing capability plane until the native encryption/key lifecycle is ported and tested.
- Android declares network, camera, microphone, notification and media permissions, but runtime prompts must be requested only when a user invokes the corresponding feature.

## Implemented foundation in this branch

- Flutter Web and Android platform projects.
- Shared routing, responsive shell, original Testagram styling and light/dark/system appearance control.
- Supabase configuration boundary and PKCE authentication.
- Email/password sign-in, password recovery/update, legal acceptance and 24-hour secure session policy.
- Feed pagination, pull-to-refresh, text/photo/video post composition, camera capture and gallery selection, media type/size validation, Supabase Storage upload with orphan cleanup on post-write failure, heart reactions, comments/replies, reposts, bookmarks, share sheet, copy-link, report submission, image rendering and tap-to-play video.
- People/post search, follow/unfollow and public profile navigation.
- Current-user profile and post listing, display name/bio/website/location editing through the canonical profile_update RPC, avatar capture/gallery selection, cover selection, size/type validation, and uploads through the existing authenticated profile-media-upload capability.
- Notification listing, mark-read and mark-all-read.
- Public IPTV catalogue sources (Kenya, news, sports and more) load progressively in batches as viewers swipe, alongside Testagram community live streams. TikVTV-style full-height feed includes channel-list fallback, provider resolver, native Android playback and a lazy-loaded Hls.js browser adapter with retry/share controls. Real-stream/device validation remains a release blocker.
- Conversation index only. Native encrypted send/receive, E2EE key management, receipts, presence, voice notes and calls are not marked complete.
- Settings, sign-out and appearance controls.
- Flutter analyzer/widget/session-policy tests.

In-app notification rows refresh through Supabase Realtime while the notifications screen is open; device/background push remains blocked on verified FCM registration and delivery. Some actions intentionally show a migration notice rather than pretending that an unfinished backend adapter is functional. These are release blockers, not completed features. In particular, the external advertising scripts, full TV production interface, creator tools, payments, commerce, federated services, all moderation/admin pages, device push delivery, microphone/voice capture, advanced profile fields/social-link and phone editing, full media lifecycle, E2EE messaging/calls and full SEO parity still need their own ports and contract tests.

## Required parity inventory

`docs/flutter-parity-inventory.json` is generated from every source file under `src/`, plus API routes, Supabase Edge Functions and migrations, and existing Android native references, plus cross-cutting product domains. Every new source file must be tracked. Update it with:

```bash
node scripts/update-flutter-parity-inventory.mjs
node scripts/validate-flutter-parity-inventory.mjs
```

A feature is accepted only after web and Android behavior, backend contract, permissions, failure recovery, accessibility, and tests are verified. See [`docs/mobile-architecture.md`](../docs/mobile-architecture.md) and [`docs/flutter-migration-plan.md`](../docs/flutter-migration-plan.md).

## Web deployment rule

`flutter build web --release` is a CI validation artifact only. It must **not** replace `testagram.site` until the route inventory, public-page SEO/metadata, canonical URLs, sitemap/robots, deep links, external ad provider behavior, authentication callbacks, accessibility, and production smoke tests pass. Flutter is well suited to app-like interactive surfaces, but public crawlable content and SEO need an explicit route-by-route strategy. The existing React site remains live during the migration.

## Android distribution variants

- Use `--flavor production` for normal developer/production builds.
- Use `--flavor fdroid` only for the unsigned F-Droid candidate build. F-Droid must sign its own published APK.
- The two variants intentionally use the same `com.xclone.app` application ID, so they cannot be installed side-by-side.
- The F-Droid flavor is a packaging boundary, not proof of F-Droid compliance. Audit the full dependency tree, third-party assets, hosted services and embedded content before submission. Do not add proprietary advertising or tracking SDKs to this flavor.

## Android release rule

The Flutter Android application uses the existing package ID `com.xclone.app`. Do not replace the published APK until the permanent production signing certificate is available and verified against the installed release; the current legacy workflow uses temporary CI signing material, which is not a safe in-place upgrade identity. Build/debug artifacts are for testing only. Do not publish the Flutter APK as the latest release before real-device auth, push, media, back-navigation, deep-link, video, low-memory and offline tests pass.
