# XClone TV for Android TV

## Download for testing

- **[Published XClone TV test APK releases](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases?q=tv-test)** — open the newest `XClone TV Test APK` prerelease and download `xclone-tv-debug.apk`.
- [Public test APK build and publishing workflow](../.github/workflows/xclone-tv-debug-release.yml).
- [Signed production TV release workflow](../.github/workflows/xclone-tv-release.yml) — requires the repository's protected TV signing secrets; do not confuse this with the debug test APK.

The test APK is a sideloadable debug build, not a production-signed release. Confirm the release notes and test on your target TV before relying on it.

This is a separate Android application project. It does not change the existing mobile app under `android/`, its application ID (`com.xclone.app`), launcher activity, or release workflow.

- TV application ID: `com.xclone.app.tv`
- Android TV launcher: `CATEGORY_LEANBACK_LAUNCHER`
- Touchscreen is optional; remote/D-pad input is supported by the WebView shell.
- Website origin: `https://testagram.site/` (the existing production web app)
- No IPTV catalog, stream-selection, buffering, or playback services are copied or modified here.

## Build

From the repository root, with JDK 21 and Android SDK installed:

```bash
cd android-tv
../android/gradlew --no-daemon assembleDebug
```

Debug APK output: `android-tv/app/build/outputs/apk/debug/app-debug.apk`.

The CI workflow builds and uploads the TV APK independently of the mobile APK workflow. Physical Android TV / Google TV testing is still required to validate the production site's D-pad focus order, sign-in, video playback, and remote-specific controls.
