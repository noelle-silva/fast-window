import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR_DIR = path.join(ROOT, 'vendor', 'everything', 'windows-x64')
const DATA_DIR = process.env.FW_EVERYTHING_SMOKE_DATA_DIR || path.join(ROOT, 'dist-app', 'v5-windows-dev', 'data')
const RUNTIME_DIR = path.join(DATA_DIR, 'everything-runtime')
const BIN_DIR = path.join(RUNTIME_DIR, 'runtime-bin')
const INSTANCE = 'fast-window-everything'
const SERVICE_NAME = 'Everything (fast-window-everything)'
const TIMEOUT_MS = 15_000

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`command timed out: ${path.basename(command)} ${args.join(' ')}`))
    }, options.timeoutMs || TIMEOUT_MS)
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

function launch(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function iniValue(value) {
  return String(value).replaceAll('\\', '\\\\')
}

async function syncRuntimeBinaries() {
  await mkdir(BIN_DIR, { recursive: true })
  const everythingSrc = path.join(VENDOR_DIR, 'Everything.exe')
  const esSrc = path.join(VENDOR_DIR, 'es.exe')
  if (!existsSync(everythingSrc) || !existsSync(esSrc)) throw new Error('Everything vendor binaries are missing')
  if (!existsSync(path.join(BIN_DIR, 'Everything.exe'))) await copyFile(everythingSrc, path.join(BIN_DIR, 'Everything.exe'))
  if (!existsSync(path.join(BIN_DIR, 'es.exe'))) await copyFile(esSrc, path.join(BIN_DIR, 'es.exe'))
}

async function writeRuntimeConfig() {
  await mkdir(RUNTIME_DIR, { recursive: true })
  await writeFile(path.join(RUNTIME_DIR, 'Everything.ini'), [
    '[Everything]',
    'app_data=0',
    'run_as_admin=0',
    'run_in_background=1',
    'show_tray_icon=0',
    'check_for_updates_on_startup=0',
    'allow_multiple_windows=0',
    'allow_http_server=0',
    `db_location=${iniValue(RUNTIME_DIR)}`,
    '',
  ].join('\r\n'), 'utf8')
}

function servicePathMatches(scOutput, expectedExe) {
  return scOutput.toLowerCase().includes(expectedExe.toLowerCase())
}

async function ensureServiceReady(everything) {
  const config = await run('sc.exe', ['qc', SERVICE_NAME], { timeoutMs: 10_000 })
  if (config.code !== 0) throw new Error(`Everything global service is not installed: ${config.stdout || config.stderr}`)
  if (!servicePathMatches(config.stdout, everything)) {
    throw new Error(`Everything global service points to a different runtime. Expected ${everything}. Actual: ${config.stdout}`)
  }
  const query = await run('sc.exe', ['query', SERVICE_NAME], { timeoutMs: 10_000 })
  if (!query.stdout.toUpperCase().includes('RUNNING')) {
    await run('sc.exe', ['start', SERVICE_NAME], { timeoutMs: 20_000 })
    await sleep(1500)
  }
}

async function waitForVersion(es) {
  const deadline = Date.now() + 30_000
  let last = null
  while (Date.now() < deadline) {
    const probe = await run(es, ['-instance', INSTANCE, '-timeout', '5000', '-get-everything-version'], { cwd: BIN_DIR, timeoutMs: 10_000 })
    last = probe
    if (probe.code === 0 && probe.stdout) return probe.stdout
    await sleep(750)
  }
  throw new Error(`Everything IPC smoke failed: exit=${last?.code} stdout=${last?.stdout || ''} stderr=${last?.stderr || ''}`)
}

async function runResultSmoke(es) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'fast-window-everything-smoke-'))
  const exportPath = path.join(tempDir, 'results.csv')
  try {
    const search = await run(es, [
      '-instance', INSTANCE,
      '-timeout', '5000',
      '-export-csv', exportPath,
      '-utf8-bom',
      '-no-header',
      '-name',
      '-path-column',
      '-size',
      '-date-modified',
      '-n', '10',
      'everything.exe',
    ], { cwd: BIN_DIR, timeoutMs: 15_000 })
    if (search.code !== 0) {
      throw new Error(`Everything result smoke failed: exit=${search.code} stdout=${search.stdout} stderr=${search.stderr}`)
    }
    const text = (await readFile(exportPath, 'utf8')).replace(/^\uFEFF/, '').trim()
    if (!text) throw new Error('Everything result smoke exported no rows')
    const rows = text.split(/\r?\n/).filter(Boolean)
    return { query: 'everything.exe', count: rows.length, sample: rows[0] }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  await syncRuntimeBinaries()
  await writeRuntimeConfig()
  const everything = path.join(BIN_DIR, 'Everything.exe')
  const es = path.join(BIN_DIR, 'es.exe')
  await ensureServiceReady(everything)
  launch(everything, [
    '-instance', INSTANCE,
    '-config', path.join(RUNTIME_DIR, 'Everything.ini'),
    '-db', path.join(RUNTIME_DIR, 'Everything.db'),
    '-startup',
  ], BIN_DIR)
  const version = await waitForVersion(es)
  const result = await runResultSmoke(es)
  console.log(JSON.stringify({ ok: true, instance: INSTANCE, service: SERVICE_NAME, version, runtimeDir: RUNTIME_DIR, result }, null, 2))
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
