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
const debugDir = path.join(tauriDir, 'target', 'debug')

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
    ? `task-manager-backend-${tuple}.exe`
    : `task-manager-backend-${tuple}`
}

function devSidecarName() {
  return process.platform === 'win32'
    ? 'task-manager-backend.exe'
    : 'task-manager-backend'
}

async function main() {
  const tuple = await hostTuple()
  const output = path.join(binariesDir, sidecarName(tuple))
  const devOutput = path.join(debugDir, devSidecarName())
  await fs.mkdir(binariesDir, { recursive: true })
  await fs.mkdir(debugDir, { recursive: true })
  await run('go', ['mod', 'download'], { cwd: backendDir })
  await run('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'], { cwd: backendDir })
  await fs.copyFile(output, devOutput)
}

main().catch(error => {
  process.stderr.write(`[task-manager-backend] ${String(error?.message || error)}\n`)
  process.exit(1)
})
