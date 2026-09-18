import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const backendDir = join(root, 'backend-go')
const outputDir = join(root, 'src-tauri', 'binaries')
const extension = process.platform === 'win32' ? '.exe' : ''
const outputName = `eucli-studio-backend${extension}`
const outputPath = join(outputDir, outputName)

mkdirSync(outputDir, { recursive: true })
removeLegacyTimestampBuilds(outputDir)

const result = spawnSync('go', ['build', '-trimpath', '-o', outputPath, '.'], {
  cwd: backendDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.status !== 0) {
  console.error('[eucli-studio] backend build failed. Close any running eucli-studio window and retry if the exe is locked.')
  process.exit(result.status || 1)
}

console.log(`[eucli-studio] backend built: ${outputPath}`)

function removeLegacyTimestampBuilds(dir) {
  const prefix = 'eucli-studio-backend-'
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue
    if (extension && !name.endsWith(extension)) continue
    const filePath = join(dir, name)
    try {
      rmSync(filePath, { force: true })
    } catch {
      throw new Error(`[eucli-studio] remove locked legacy backend first: ${filePath}`)
    }
  }
}
