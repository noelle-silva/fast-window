Place bundled backend runtimes here.

Expected Node layout:

- `node/node.exe` on Windows
- `node/node` on Unix-like platforms

v3 plugin `background.main` JavaScript files are executed only with this bundled runtime.
The host intentionally does not fall back to a system-installed Node runtime.
