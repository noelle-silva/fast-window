import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')

async function copyBackend(target) {
  await fs.rm(path.join(target, 'backend'), { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  await fs.cp(path.join(appDir, 'backend'), path.join(target, 'backend'), { recursive: true })
}

async function copyAssets(target) {
  await fs.rm(path.join(target, 'assets'), { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  await fs.cp(path.join(appDir, 'assets'), path.join(target, 'assets'), { recursive: true })
}

async function copyResources(target) {
  await copyBackend(target)
  await copyAssets(target)
}

// dev: copy to the directory where the exe lives during `tauri dev`
await copyResources(path.join(appDir, 'src-tauri', 'target', 'debug'))
// production: copy to Tauri resource dir for bundling
await copyResources(path.join(appDir, 'src-tauri', 'target', 'resources'))
