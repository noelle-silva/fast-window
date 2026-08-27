import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')

async function copyAssets(target) {
  await fs.rm(path.join(target, 'assets'), { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  await fs.cp(path.join(appDir, 'assets'), path.join(target, 'assets'), { recursive: true })
}

await copyAssets(path.join(appDir, 'src-tauri', 'target', 'debug'))
await copyAssets(path.join(appDir, 'src-tauri', 'target', 'resources'))
