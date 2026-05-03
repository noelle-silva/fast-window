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
    ? `bookmarks-backend-${tuple}.exe`
    : `bookmarks-backend-${tuple}`
}

async function main() {
  const tuple = await hostTuple()
  const output = path.join(binariesDir, sidecarName(tuple))
  await fs.mkdir(binariesDir, { recursive: true })
  await run('go', ['mod', 'download'], { cwd: backendDir })
  await run('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'], { cwd: backendDir })
}

main().catch(error => {
  process.stderr.write(`[bookmarks-go-backend] ${String(error?.message || error)}\n`)
  process.exit(1)
})
