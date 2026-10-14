# F-Droid readiness assessment

Status: **not ready for official F-Droid submission**. This document records source-verified blockers and the acceptance gates. It is not a claim of F-Droid approval.

## Source facts verified on 2026-10-14

- Flutter app source is under `mobile/`; `mobile/pubspec.yaml` currently declares `version: 0.3.0+5`.
- Flutter Android package ID is `com.xclone.app`, with `minSdk = 24`, in `mobile/android/app/build.gradle.kts`.
- The repository root currently has no `LICENSE` file. A Flutter-specific `mobile/LICENSE` was also not found.
- The current root Android release workflow, `.github/workflows/android-release.yml`, builds the legacy root `android/` WebView app and creates a new temporary signing key in CI. It is not a durable signing identity and is not the Flutter build.
- `mobile/pubspec.yaml` declares `supabase_flutter` and `youtube_player_iframe` in addition to Flutter/plugin packages. A declared dependency is not by itself proof of a policy violation, but the dependency graph and runtime service dependencies need a license and policy review.
- The app uses the Testagram logo asset. The source and redistribution rights for that logo, fonts, media, and other bundled assets have not yet been documented.
- The repository's public Android release tags (for example `v0.2.526`) refer to the separate root Android release workflow. They must not be treated as a release tag for the Flutter app unless the tagged commit is verified to contain the exact Flutter source being submitted.
- Upstream Fastlane description/changelog files are being prepared, but the required phone screenshots and a PNG store icon have not been verified in the metadata tree.

## Blockers before submitting

1. **License and ownership**
   - Confirm the submitter owns or has redistribution rights for every source file and asset to be licensed.
   - Choose a recognized FOSS license with the rights holder's informed approval. Do not apply a blanket license to third-party, copied, generated, or unlicensed material without establishing the rights.
   - Add a root license only when its scope is clear; include third-party notices and a dependency/asset license inventory.
2. **F-Droid-compatible variant**
   - An explicit `fdroid` Android flavor and unsigned candidate-build workflow now exist on the preparation branch. CI must prove the build works before it is considered usable.
   - The flavor currently shares the Flutter source and dependency graph with production; it is a packaging boundary, not yet a demonstrated removal of all potentially incompatible integrations.
   - Audit all direct and transitive Dart/Flutter, Gradle, Android, and bundled native dependencies, including license files and downloaded toolchains.
   - Keep the legacy root Android release flow and the Flutter production-signed release separate; verify production output paths and signing checks after adding the flavor.
   - Determine whether the app's dependence on the hosted Testagram/Supabase backend, embedded YouTube content, IPTV providers, and other network services requires removal, a functional alternative, or disclosure under F-Droid policy. Do not silently claim these services are free software.
3. **Releases and build reproducibility**
   - Publish a Flutter-specific immutable release tag whose source commit builds the submitted Android app from source.
   - Align the tag, `pubspec.yaml` version/build number, Android manifest package ID, F-Droid metadata versionName/versionCode, and changelog.
   - Pin the exact Flutter SDK revision and dependency lockfile. Build offline/isolated where possible and document unavoidable network fetches.
   - Verify the APK package ID, min SDK, permissions, signing certificate, SHA-256, and install/upgrade behavior on a clean Android device.
4. **Metadata and assets**
   - Complete the Fastlane English description files.
   - Add a legally redistributable PNG icon and at least two real phone screenshots; do not fabricate screenshots.
   - Add a version-code changelog and verify all assets are redistributable.
5. **Upstream submission**
   - Create `metadata/com.xclone.app.yml` in a fork of `fdroiddata` only after the exact source tag and build recipe have passed local validation.
   - Run `fdroid readmeta`, `fdroid lint com.xclone.app`, and `fdroid build com.xclone.app` in a suitable F-Droid build environment.
   - Open a merge request to https://gitlab.com/fdroid/fdroiddata and respond to maintainers' review. Acceptance is solely theirs.

## Signing: do not reuse temporary CI keys

The official F-Droid repository signs APKs with its own infrastructure. The developer's production signing key is a separate concern. Do not commit a keystore or passwords, print secrets in logs, or generate a fresh key on every release. If Testagram publishes its own signed APKs, store the durable key in a protected secret store and verify its certificate fingerprint before any release. Since the current legacy workflow documents temporary signing, existing APKs must not be represented as having a stable update identity.

## Candidate metadata

- App ID: `com.xclone.app` (verify against the exact Flutter release tag)
- App name: Testagram
- Source: https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr
- Website: https://testagram.site/
- Current Flutter source version: `0.3.0+5` (not yet established as an F-Droid-ready tagged release)
- Minimum Android SDK: 24
- License: **unresolved — do not submit until ownership and licensing are confirmed**
- F-Droid build recipe: **candidate CI build added; still not ready until the workflow passes and an fdroiddata build recipe is validated in F-Droid's build environment**

## Official guidance

- https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/
- https://fdroid.gitlab.io/jekyll-fdroid/en/docs/Inclusion_Policy/
- https://gitlab.com/fdroid/fdroiddata/-/blob/master/templates/build-flutter.yml
