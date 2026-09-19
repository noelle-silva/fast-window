import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 宿主开发链共享底座：目录定位、进程运行、摘要与通用校验。
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const rootDir = path.resolve(__dirname, '..', '..')

export function isSafeId(id) {
  return /^[A-Za-z0-9_-]+$/.test(String(id || '').trim())
}

export function parseSemverStrict(raw) {
  const s = String(raw || '').trim()
  return /^\d+\.\d+\.\d+$/.test(s) ? s : ''
}

export function compareSemverStrict(aRaw, bRaw) {
  const a = String(aRaw || '').trim().split('.').map(Number)
  const b = String(bRaw || '').trim().split('.').map(Number)
  if (a.length !== 3 || b.length !== 3 || !parseSemverStrict(aRaw) || !parseSemverStrict(bRaw)) {
    throw new Error(`版本号必须是 x.y.z 格式: ${aRaw} / ${bRaw}`)
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

export function scriptArgs(argv) {
  return argv.slice(2).filter(arg => arg !== '--')
}

function cmdQuote(value) {
  const raw = String(value)
  if (!raw) return '""'
  if (!/[\s"^&|<>%]/.test(raw)) return raw
  return `"${raw.replaceAll('%', '%%').replace(/["^]/g, match => `^${match}`)}"`
}

function resolveSpawnSpec(command, args) {
  if (process.platform === 'win32' && command === 'pnpm') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', ['pnpm.cmd', ...args].map(cmdQuote).join(' ')],
    }
  }
  return { command, args }
}

export function run(command, args, cwd, opts = {}) {
  return new Promise((resolve, reject) => {
    const spec = resolveSpawnSpec(command, args)
    const child = spawn(spec.command, spec.args, { cwd, stdio: 'inherit', shell: false, ...opts })
    child.on('error', reject)
    child.on('exit', code => {
      if ((code ?? 0) === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed with exit ${code}`))
    })
  })
}

export async function sha256FileHex(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fssync.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
