# AI Once

AI Once is a Fast Window v5 registered app migrated from `plugins/ai-once`.

It runs as an independent Tauri app with a Go sidecar backend. The app owns its window, runtime control server, single-instance guard, data directory pointer, business data, tray behavior, and shutdown lifecycle.

## Commands

- `open-settings`: open the provider/settings view.
- `ask-once`: open the one-shot prompt view.
- `new-prompt`: clear the current prompt and start a new one-shot request.

## Data

The Rust shell stores only the data directory pointer in the Tauri app config directory. The Go backend stores business data in the selected data directory:

- `_meta.json`
- `_migrations.json`
- `settings.json`
- `history.json`

## Build

```txt
pnpm --dir apps/ai-once build:backend
pnpm --dir apps/ai-once build:ui
cargo check --manifest-path apps/ai-once/src-tauri/Cargo.toml
```
