import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const backendDir = path.join(appDir, 'backend-go')
const tauriDir = path.join(appDir, 'src-tauri')
const binariesDir = path.join(tauriDir, 'binaries')
const devSidecarDir = path.join(tauriDir, 'target', 'debug')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: appDir, ...options }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
      if (error) reject(error)
      else resolve()
    })
  })
}

async function hostTuple() {
  const chunks = []
  await new Promise((resolve, reject) => {
    execFile('rustc', ['--print', 'host-tuple'], (error, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr)
      if (error) reject(error)
      else {
        chunks.push(stdout)
        resolve()
      }
    })
  })
  const tuple = chunks.join('').trim()
  if (!tuple) throw new Error('Failed to resolve Rust host tuple')
  return tuple
}

function sidecarName(tuple) {
  return process.platform === 'win32'
    ? `ai-draw-backend-${tuple}.exe`
    : `ai-draw-backend-${tuple}`
}

function devSidecarName() {
  return process.platform === 'win32' ? 'ai-draw-backend.exe' : 'ai-draw-backend'
}

async function main() {
  const backendStat = await fs.stat(backendDir).catch(() => null)
  if (!backendStat?.isDirectory()) {
    throw new Error('apps/ai-draw/backend-go is not implemented yet; complete the Go sidecar phase before building the backend')
  }

  const tuple = await hostTuple()
  const output = path.join(binariesDir, sidecarName(tuple))
  const devOutput = path.join(devSidecarDir, devSidecarName())
  await fs.mkdir(binariesDir, { recursive: true })
  await fs.mkdir(devSidecarDir, { recursive: true })
  await run('go', ['mod', 'download'], { cwd: backendDir })
  await run('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'], { cwd: backendDir })
  await fs.copyFile(output, devOutput)
}

main().catch(error => {
  process.stderr.write(`[ai-draw-go-backend] ${String(error?.message || error)}\n`)
  process.exit(1)
})
