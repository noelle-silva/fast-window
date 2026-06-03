# Everything

Fast Window v5 registered app for packaged voidtools Everything search.

## Runtime Model

- The app packages official `Everything.exe` and `es.exe` under `vendor/everything/windows-x64/`.
- Build and runtime validation use `vendor-manifest.json` sha256 entries.
- Runtime settings, database and setup state are written under the app data directory.
- Development and release builds use separate app-owned Everything identities so both packages can coexist.
- Development global indexing uses `fast-window-everything-dev` and `Everything (fast-window-everything-dev)`.
- Release global indexing uses `fast-window-everything-release` and `Everything (fast-window-everything-release)`.
- Each channel validates its own service root and fails fast on runtime path mismatches.
- Search runs through the packaged `es.exe` against the app-owned global Everything instance.

## Build

```powershell
pnpm --dir apps/everything vendor:check
pnpm --dir apps/everything build:ui
pnpm --dir apps/everything build:app
pnpm --dir apps/everything build:app:dev
```

## Registration

Register the staged app entry executable from:

```txt
apps/everything/dist-app/v5-windows/package/everything.exe
```

For dev registration use:

```txt
apps/everything/dist-app/v5-windows-dev/package/everything.exe
```

## Verification

```powershell
pnpm --dir apps/everything vendor:check
pnpm --dir apps/everything smoke:runtime
cd apps/everything/backend-go; go test ./...
pnpm --dir apps/everything exec tsc --noEmit
cargo check --manifest-path apps/everything/src-tauri/Cargo.toml
```
