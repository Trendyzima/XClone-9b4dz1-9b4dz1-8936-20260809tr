# XClone TV for Android TV

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
