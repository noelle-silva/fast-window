import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scriptArgs } from './lib/v5-cli-args.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const out = { zip: '', catalog: '', appId: '', expectFailure: '', mutateCatalogSha: false }
  const args = scriptArgs(argv)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--zip' && i + 1 < args.length) {
      out.zip = path.resolve(rootDir, String(args[++i] || '').trim())
      continue
    }
    if (arg === '--catalog' && i + 1 < args.length) {
      out.catalog = path.resolve(rootDir, String(args[++i] || '').trim())
      continue
    }
    if (arg === '--app' && i + 1 < args.length) {
      out.appId = String(args[++i] || '').trim()
      continue
    }
    if (arg === '--expect-failure' && i + 1 < args.length) {
      out.expectFailure = String(args[++i] || '').trim()
      continue
    }
    if (arg === '--mutate-catalog-sha') {
      out.mutateCatalogSha = true
      continue
    }
  }
  if (!out.zip || !out.catalog || !out.appId) {
    throw new Error('Usage: node scripts/verify-v5-app-package.mjs --zip <zip> --catalog <catalog.json> --app <id>')
  }
  if (!isSafeId(out.appId)) throw new Error(`app id 不合法: ${out.appId}`)
  return out
}

function isSafeId(id) {
  return /^[A-Za-z0-9_-]+$/.test(String(id || '').trim())
}

function isSemver(raw) {
  return /^\d+\.\d+\.\d+$/.test(String(raw || '').trim())
}

function safeRel(raw, field) {
  const rel = String(raw || '').trim().replaceAll('\\', '/')
  if (!rel) throw new Error(`${field} 不能为空`)
  if (path.isAbsolute(rel)) throw new Error(`${field} 不允许是绝对路径: ${rel}`)
  const parts = rel.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`${field} 不安全: ${rel}`)
  return rel
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('exit', code => {
      if ((code ?? 0) === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(' ')} failed with exit ${code}\n${stderr}`))
    })
  })
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function sha256FileHex(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fssync.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function extractZip(zipPath) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-v5-app-verify-'))
  try {
    await run('tar', ['-xf', zipPath, '-C', tempDir], rootDir)
    return tempDir
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true })
    throw error
  }
}

async function findSingleManifestRoot(extractDir) {
  const roots = []
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (entry.isFile() && entry.name === 'fw-app.json') roots.push(path.dirname(full))
    }
  }
  await walk(extractDir)
  if (roots.length !== 1) throw new Error(`ZIP 内必须有且只能有一个 fw-app.json，实际数量: ${roots.length}`)
  return roots[0]
}

function validateCommands(commands) {
  if (!Array.isArray(commands)) throw new Error('fw-app.commands 必须是数组')
  const seen = new Set()
  for (const command of commands) {
    const id = String(command?.id || '').trim()
    const title = String(command?.title || '').trim()
    if (!isSafeId(id)) throw new Error(`fw-app.commands.id 不合法: ${id}`)
    if (!title || title.length > 80) throw new Error(`fw-app.commands.title 不合法: ${id}`)
    if (seen.has(id)) throw new Error(`fw-app.commands.id 重复: ${id}`)
    seen.add(id)
  }
}

async function validatePackage(zipPath, appId) {
  const extractDir = await extractZip(zipPath)
  try {
    const root = await findSingleManifestRoot(extractDir)
    const manifest = await readJson(path.join(root, 'fw-app.json'))
    if (manifest.id !== appId) throw new Error(`fw-app.id 不匹配: expected=${appId}, got=${manifest.id}`)
    if (!isSafeId(manifest.id)) throw new Error(`fw-app.id 不合法: ${manifest.id}`)
    if (!String(manifest.name || '').trim()) throw new Error('fw-app.name 不能为空')
    if (!isSemver(manifest.version)) throw new Error(`fw-app.version 必须是 x.y.z: ${manifest.version}`)
    const executable = safeRel(manifest.windowsExecutable, 'fw-app.windowsExecutable')
    if (!executable.toLowerCase().endsWith('.exe')) throw new Error('fw-app.windowsExecutable 必须指向 .exe')
    if (!(await exists(path.join(root, executable)))) throw new Error(`fw-app.windowsExecutable 文件不存在: ${executable}`)
    if (manifest.icon) {
      const icon = String(manifest.icon || '').trim()
      if (!icon.startsWith('data:image/') && !(icon.length <= 8 && !/[\\/.]/.test(icon))) {
        const iconRel = safeRel(icon, 'fw-app.icon')
        if (!(await exists(path.join(root, iconRel)))) throw new Error(`fw-app.icon 文件不存在: ${iconRel}`)
      }
    }
    validateCommands(manifest.commands || [])
    return manifest
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true })
  }
}

function validateCatalogShape(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('catalog 必须是对象')
  if (catalog.catalogVersion !== 2) throw new Error('catalogVersion 必须为 2')
  if (!Array.isArray(catalog.apps)) throw new Error('catalog.apps 必须是数组')
  if (!Array.isArray(catalog.plugins)) throw new Error('catalog.plugins 必须是数组')
}

async function validateCatalog(catalogPath, appId, manifest, zipPath, options = {}) {
  const catalog = await readJson(catalogPath)
  validateCatalogShape(catalog)
  const entries = catalog.apps.filter(app => String(app?.id || '').trim() === appId)
  if (entries.length !== 1) throw new Error(`catalog.apps 必须有且只能有一个 ${appId} 条目，实际数量: ${entries.length}`)
  const entry = entries[0]
  if (entry.version !== manifest.version) throw new Error(`catalog version 与 fw-app version 不一致: ${entry.version} != ${manifest.version}`)
  if (!entry.platforms || typeof entry.platforms !== 'object') throw new Error('catalog app platforms 缺失')
  const win = entry.platforms.windows
  if (!win || typeof win !== 'object') throw new Error('catalog app platforms.windows 缺失')
  if (options.mutateCatalogSha) win.sha256 = '0'.repeat(64)
  if (!String(win.downloadUrl || '').startsWith('https://')) throw new Error('catalog downloadUrl 必须是 https://')
  const actualSha = await sha256FileHex(zipPath)
  if (String(win.sha256 || '').toLowerCase() !== actualSha) throw new Error('catalog sha256 与 ZIP 实际值不一致')
  const size = (await fs.stat(zipPath)).size
  if (win.sizeBytes !== undefined && win.sizeBytes !== size) throw new Error('catalog sizeBytes 与 ZIP 实际大小不一致')
  validateCommands(entry.commands || [])
  return { catalog, entry, sha256: actualSha, sizeBytes: size }
}

async function main() {
  const opts = parseArgs(process.argv)
  try {
    const manifest = await validatePackage(opts.zip, opts.appId)
    const result = await validateCatalog(opts.catalog, opts.appId, manifest, opts.zip, {
      mutateCatalogSha: opts.mutateCatalogSha,
    })
    if (opts.expectFailure) throw new Error(`期望失败但验证通过: ${opts.expectFailure}`)
    console.log(JSON.stringify({
      appId: opts.appId,
      version: manifest.version,
      zip: opts.zip,
      catalog: opts.catalog,
      sha256: result.sha256,
      sizeBytes: result.sizeBytes,
      downloadUrl: result.entry.platforms.windows.downloadUrl,
    }, null, 2))
  } catch (error) {
    if (!opts.expectFailure) throw error
    const message = String(error?.message || error)
    if (!message.includes(opts.expectFailure)) {
      throw new Error(`失败原因不匹配：expected includes "${opts.expectFailure}", got "${message}"`)
    }
    console.log(JSON.stringify({ expectedFailure: opts.expectFailure, message }, null, 2))
  }
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
