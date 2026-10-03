# Testagram Android 0.2.0

Production WebView release: the Android application uses https://testagram.site/ as its single UI and feature surface. No mock Flutter UI is used.

- Website-responsive UI is rendered directly from Testagram.
- Firebase push/deep links remain enabled.
- Camera, microphone and media upload permissions are handled by the production shell.
- TLS errors are rejected; WebView debugging is disabled.
- Launcher branding remains the Testagram app icon assets.
