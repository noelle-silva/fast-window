Place bundled plugin backend runtimes here.

Expected layout:

- `node/node.exe` on Windows, `node/node` on Unix-like platforms
- `python/python.exe` on Windows, `python/python` on Unix-like platforms
- `deno/deno.exe` on Windows, `deno/deno` on Unix-like platforms
- `bun/bun.exe` on Windows, `bun/bun` on Unix-like platforms

Extension mapping:

- `.js/.mjs/.cjs` -> bundled Node
- `.py` -> bundled Python
- `.ts` -> bundled Deno by default, or Bun when `background.runtime` is `bun`
- `.exe` -> direct plugin executable

Launch shape:

- Node: `node <script>`
- Python: `python -u <script>`
- Deno: `deno run --allow-all <script>`
- Bun: `bun run <script>`
- Direct: `<plugin executable>`

Plugin backends never fall back to user-installed system runtimes.
