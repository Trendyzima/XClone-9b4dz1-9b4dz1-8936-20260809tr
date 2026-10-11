# Testagram Mobile Architecture Contract

## Product ownership
Flutter owns the mobile presentation layer. It should not duplicate server-side business rules that already belong in Supabase Edge Functions/RPCs.

## Boundary
```
Flutter UI
  -> feature/domain services
  -> typed API/repository boundary
  -> Supabase Auth / Postgres / Realtime / Storage / Edge Functions
  -> native capability adapters only when Android/iOS requires platform APIs
```

## Native capability rule
Native code is allowed for:
- FCM and notification lifecycle
- background execution
- camera/microphone/media codecs
- secure OS storage and biometric APIs
- deep links/app links
- platform-specific audio/video or call integration

Native code must expose small, typed interfaces to Flutter. Product screens must not contain platform-channel implementation details.

## Migration safety
- The current WebView Android client remains a rollback path.
- Each migrated feature must have a production contract test before the corresponding WebView feature is retired.
- Auth, push, deep links, media upload, realtime subscriptions and offline recovery are release blockers.
- No service-account keys or privileged Supabase credentials enter Flutter assets.
- Public Supabase credentials may only be used with RLS/Edge Function enforcement.

## 10/10 release gates
1. `flutter analyze` clean.
2. Widget tests green.
3. Android debug/release build green.
4. Deep-link routing verified.
5. FCM foreground/background/tap behavior verified.
6. Auth refresh and sign-out verified.
7. Feed pagination/realtime recovery verified.
8. Media upload/camera/microphone permission flows verified.
9. Offline/poor-network recovery verified.
10. Production smoke test against the same backend contracts used by web.

## Rollout
Flutter is introduced feature-by-feature behind explicit parity gates. There is no big-bang cutover.

## Shared Web + Android migration

The shared Flutter project lives in `mobile/` and targets both browser and Android. The checked-in parity inventory is generated from the existing React page/feature/service source files and must be validated in CI. The migration is deliberately additive: the current React website remains live and the current Android WebView release remains a rollback client until each feature passes parity tests.

See [`flutter-migration-plan.md`](./flutter-migration-plan.md) for the phase gates, and [`flutter-parity-inventory.json`](./flutter-parity-inventory.json) for the source-level inventory. A Flutter Web build passing is not authorization to deploy it to `testagram.site`; SEO, route/deep-link, ad-provider and full feature parity are separate blockers.
