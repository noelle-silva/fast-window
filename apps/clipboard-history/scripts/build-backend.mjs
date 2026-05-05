import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const backendDir = path.join(appDir, 'backend-rs')
const tauriDir = path.join(appDir, 'src-tauri')
const binariesDir = path.join(tauriDir, 'binaries')
const devExeDir = path.join(tauriDir, 'target', 'debug')
const sidecarBase = 'clipboard-history-backend'

const args = new Set(process.argv.slice(2))
for (const arg of args) {
  if (arg !== '--release' && arg !== '--dev-copy') {
    throw new Error(`Unknown argument: ${arg}`)
  }
}

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
    ? `${sidecarBase}-${tuple}.exe`
    : `${sidecarBase}-${tuple}`
}

function builtBinaryName() {
  return process.platform === 'win32' ? `${sidecarBase}.exe` : sidecarBase
}

async function main() {
  const tuple = await hostTuple()
  const profile = args.has('--release') || process.env.FW_CLIPBOARD_HISTORY_BACKEND_PROFILE === 'release' ? 'release' : 'debug'
  const copyDevSidecar = args.has('--dev-copy')
  const cargoArgs = ['build', '--manifest-path', path.join(backendDir, 'Cargo.toml')]
  if (profile === 'release') cargoArgs.push('--release')

  await fs.mkdir(binariesDir, { recursive: true })
  await run('cargo', cargoArgs, { cwd: appDir })

  const source = path.join(backendDir, 'target', profile, builtBinaryName())
  const output = path.join(binariesDir, sidecarName(tuple))
  await fs.copyFile(source, output)

  if (!copyDevSidecar) return

  await fs.mkdir(devExeDir, { recursive: true })
  try {
    await fs.copyFile(source, path.join(devExeDir, builtBinaryName()))
  } catch (error) {
    if (error?.code === 'EBUSY' || error?.code === 'EPERM') {
      throw new Error('开发版 sidecar 正在运行，无法覆盖。请先退出 clipboard-history-app.exe / clipboard-history-backend.exe 后再构建 dev exe。')
    }
    throw error
  }
}

main().catch(error => {
  process.stderr.write(`[clipboard-history-backend] ${String(error?.message || error)}\n`)
  process.exit(1)
})
