import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')

await fs.mkdir(path.join(appDir, 'backend'), { recursive: true })

await esbuild.build({
  entryPoints: [path.join(appDir, 'src', 'backend', 'index.ts')],
  outfile: path.join(appDir, 'backend', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  sourcemap: true,
  external: ['ws'],
})
