# Testagram Desktop

## Download preview installers

- [Windows, macOS and Linux desktop preview releases](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases?q=desktop)
- [Desktop installer build workflow](../.github/workflows/platform-apps-release.yml)

The workflow is configured to build Windows MSI/EXE, macOS DMG and Linux DEB/AppImage installers. These are preview builds; download only a format attached to a successfully published release. They are not currently a promise of code-signed commercial distribution or platform-store approval.

Tauri desktop client for Testagram.

## Architecture

The desktop client uses the existing Testagram React/Vite frontend and the same authenticated capability backend as the web client. It does not introduce a second API or database.

## Development

Install Rust and the Tauri prerequisites for your operating system, then run:

    npm install
    npm run tauri:dev

The root Vite app remains the source of the desktop UI. Native functionality should be added through Tauri commands/plugins rather than duplicating web business logic.
