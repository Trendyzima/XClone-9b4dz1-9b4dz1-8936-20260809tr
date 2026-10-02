# Testagram Desktop

Tauri desktop client for Testagram.

## Architecture

The desktop client uses the existing Testagram React/Vite frontend and the same authenticated capability backend as the web client. It does not introduce a second API or database.

## Development

Install Rust and the Tauri prerequisites for your operating system, then run:

    npm install
    npm run tauri:dev

The root Vite app remains the source of the desktop UI. Native functionality should be added through Tauri commands/plugins rather than duplicating web business logic.
