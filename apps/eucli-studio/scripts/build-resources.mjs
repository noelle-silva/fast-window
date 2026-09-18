import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

mkdirSync(join(root, 'assets'), { recursive: true })
mkdirSync(join(root, 'src-tauri', 'binaries'), { recursive: true })

console.log('[eucli-studio] resources ready')
