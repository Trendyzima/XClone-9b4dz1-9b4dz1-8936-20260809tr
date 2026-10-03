# Testagram Mobile — Flutter Foundation

Testagram mobile is being migrated from the current WebView shell to Flutter incrementally.

## Target architecture
- Flutter: product UI, navigation, feeds, profiles, messaging UI, settings, notification UI, state and presentation logic.
- Supabase: authentication/session, data APIs, realtime, storage metadata and server-side business rules.
- Native Android/Kotlin: FCM, notification channels, background execution, media/camera/microphone integrations, deep links and other Android-only capabilities.
- Existing web app: remains the source of truth during migration and continues serving testagram.site.

## Migration rule
No feature is removed from the current Android client until its Flutter replacement is validated against production behavior and backend contracts.

## Phases
1. Foundation + design system.
2. Auth/session parity.
3. Home/feed + compose.
4. Profiles/explore/trending.
5. Notifications + messaging.
6. Media/video/camera.
7. Spaces/TV mobile surfaces.
8. Fediverse surfaces.
9. Offline/cache/performance.
10. Native Android parity and release validation.

The WebView shell remains the rollback path until Flutter reaches feature parity.
