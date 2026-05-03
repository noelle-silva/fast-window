import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { execFile, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const repoRoot = path.resolve(appDir, '..', '..')
const tauriDir = path.join(appDir, 'src-tauri')
const binariesDir = path.join(tauriDir, 'binaries')
const backendEntry = path.join(appDir, 'backend', 'index.cjs')
const seaBuildDir = path.join(binariesDir, '.sea')
const seaConfigPath = path.join(seaBuildDir, 'sea-config.json')
const seaBlobPath = path.join(seaBuildDir, 'bookmarks-backend.blob')
const runtimeNodePath = path.join(repoRoot, 'src-tauri', 'runtimes', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

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

function runInherit(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32', ...options })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
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
  if (!(await fileExists(backendEntry))) {
    throw new Error(`Backend bundle missing: ${backendEntry}. Run pnpm build:backend first.`)
  }
  if (!(await fileExists(runtimeNodePath))) {
    throw new Error(`Bundled Node runtime missing: ${runtimeNodePath}`)
  }

  const tuple = await hostTuple()
  const sidecarPath = path.join(binariesDir, sidecarName(tuple))
  await fs.mkdir(binariesDir, { recursive: true })
  await fs.mkdir(seaBuildDir, { recursive: true })

  await fs.writeFile(seaConfigPath, `${JSON.stringify({
    main: backendEntry.replaceAll('\\', '/'),
    output: seaBlobPath.replaceAll('\\', '/'),
    disableExperimentalSEAWarning: true,
  }, null, 2)}\n`)

  await run(runtimeNodePath, ['--experimental-sea-config', seaConfigPath])
  await fs.copyFile(runtimeNodePath, sidecarPath)
  await runInherit(pnpmCommand, [
    'exec',
    'postject',
    sidecarPath,
    'NODE_SEA_BLOB',
    seaBlobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ])
}

main().catch(error => {
  process.stderr.write(`[bookmarks-sidecar] ${String(error?.message || error)}\n`)
  process.exit(1)
})
