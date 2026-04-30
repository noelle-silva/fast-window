import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')

const resourceDir = path.join(appDir, 'src-tauri', 'target', 'resources')
await fs.mkdir(resourceDir, { recursive: true })

await fs.rm(path.join(resourceDir, 'backend'), { recursive: true, force: true })
await fs.cp(path.join(appDir, 'backend'), path.join(resourceDir, 'backend'), { recursive: true })
