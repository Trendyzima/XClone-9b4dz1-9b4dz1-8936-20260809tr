# Native Flutter Android release signing

The native Flutter release workflow intentionally **fails closed** when signing secrets are absent. It does not generate a new release key on each run.

## One-time setup

1. Generate a release/upload keystore on a trusted, encrypted computer. Keep at least two secure backups, stored separately. Do not commit the keystore or passwords to Git.
2. Use a unique, strong store password and key password. Record the alias exactly; losing the keystore or its credentials can prevent future APK updates.
3. Add the following repository **Actions secrets** under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `TESTAGRAM_ANDROID_KEYSTORE_BASE64` | Base64 encoding of the binary `.jks` file |
| `TESTAGRAM_ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `TESTAGRAM_ANDROID_KEY_ALIAS` | Alias used when creating the key |
| `TESTAGRAM_ANDROID_KEY_PASSWORD` | Private-key password |

Example keystore generation (run locally; choose passwords interactively and keep them private):

```bash
keytool -genkeypair -v \
  -keystore testagram-android-release.jks \
  -storetype JKS \
  -alias testagram-upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

Encode the file for the `TESTAGRAM_ANDROID_KEYSTORE_BASE64` secret:

- Linux: `base64 -w 0 testagram-android-release.jks`
- macOS: `base64 < testagram-android-release.jks | tr -d '\n'`
- PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("testagram-android-release.jks"))`

Paste the output directly into the secret value. Never put it into a commit, issue, chat, workflow log, or public artifact. Delete temporary encoded text from your clipboard/history after setting the secret.

## Publish the native Flutter APK

After the workflow and app changes are merged, open **Actions → Testagram Native Flutter Android Release → Run workflow**. Use a new semantic tag such as `v0.3.0`; never reuse a published tag. The workflow resolves dependencies, runs Flutter analysis/tests, builds a release APK and AAB, verifies the APK package ID is `com.xclone.app`, verifies the APK signature, and publishes a release containing exactly one APK (`app-release.apk)) plus one AAB (`app-release.aab`). The README's stable `releases/latest/download/app-release.apk` link then follows that latest release.

## Important migration and Play Protect limitations

- **Do not generate a fresh signing key for each release.** The same persistent key must sign future direct-download APKs.
- A signature proves artifact identity and supports update verification; it does **not** guarantee that Google Play Protect will suppress warnings. Do not instruct users to disable Play Protect to install an app.
- The legacy Android workflow created temporary CI signing material and deleted it after each run. Unless the exact certificate for a user's installed legacy APK is available, Android may reject the Flutter APK as an in-place update even though the package ID is the same. In that case, users need a clearly announced uninstall/reinstall migration; uninstalling clears local app data/session state, so users should confirm account data is synchronized first.
- Before announcing the APK as production-ready, test the downloaded artifact on real Android devices: clean install, sign-in/session persistence, upgrade behavior, app links, video playback, background/notification permissions, offline handling, and low-memory recovery. A green CI build is not a substitute for device validation.
