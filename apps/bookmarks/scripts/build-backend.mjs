import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const backendDir = path.join(appDir, 'backend')

await fs.rm(backendDir, { recursive: true, force: true })
await fs.mkdir(backendDir, { recursive: true })

await esbuild.build({
  entryPoints: [path.join(appDir, 'src', 'backend', 'index.ts')],
  outfile: path.join(backendDir, 'index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
})
