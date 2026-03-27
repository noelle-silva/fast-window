import path from 'node:path'
import process from 'node:process'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const DEFAULT_OWNER = 'noelle-silva'
const DEFAULT_REPO = 'fast-window-plugins-download'
const DEFAULT_REMOTE = `https://github.com/${DEFAULT_OWNER}/${DEFAULT_REPO}.git`
const DEFAULT_BRANCH = 'main'
const DEFAULT_STORE_DIR = path.join(rootDir, 'plugin-store')
const DEFAULT_OUT_DIR = path.join(rootDir, '.tmp', 'dist-plugin-zips')
const DEFAULT_PLUGINS_DIR = path.join(rootDir, 'plugins')

function parseSemverStrict(raw) {
  const s = String(raw || '').trim()
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null
  if (major < 0 || minor < 0 || patch < 0) return null
  return { major, minor, patch, raw: s }
}

function cmpSemverStrict(aRaw, bRaw) {
  const a = parseSemverStrict(aRaw)
  const b = parseSemverStrict(bRaw)
  if (!a) throw new Error(`版本号必须是 x.y.z 格式（SemVer）：${String(aRaw || '').trim()}`)
  if (!b) throw new Error(`index.json 中存在不合法版本号（必须是 x.y.z）：${String(bRaw || '').trim()}`)
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

async function loadDotEnvIfPresent() {
  const candidates = [
    path.join(rootDir, '.env.local'),
    path.join(rootDir, '.env'),
  ]

  for (const p of candidates) {
    let raw = ''
    try {
      raw = await fs.readFile(p, 'utf8')
    } catch {
      continue
    }

    const lines = raw.split(/\r?\n/g)
    for (const line0 of lines) {
      const line = String(line0 || '').trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      if (!key) continue
      if (Object.prototype.hasOwnProperty.call(process.env, key)) continue
      let value = line.slice(idx + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, ...opts })
}

async function runInherit(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  const code = await new Promise(resolve => p.on('exit', c => resolve(c ?? 0)))
  if (code !== 0) throw new Error(`${cmd} failed: exit ${code}`)
}

function pickToken() {
  const t =
    (process.env.GITHUB_TOKEN || '').trim() ||
    (process.env.FAST_WINDOW_GITHUB_TOKEN || '').trim() ||
    (process.env.GH_TOKEN || '').trim()
  return t
}

async function httpJson(method, url, token, body) {
  const headers = {
    'User-Agent': 'fast-window-plugin-store',
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  let resp
  try {
    resp = await fetch(url, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new Error(`GitHub API ${method} ${url} fetch failed`, { cause: e })
  }
  const text = await resp.text()
  if (!resp.ok) {
    const err = new Error(`GitHub API ${method} ${url} failed: HTTP ${resp.status}\n${text}`)
    err.status = resp.status
    throw err
  }
  return text ? JSON.parse(text) : null
}

async function httpUpload(url, token, bytes, contentType) {
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'fast-window-plugin-store',
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': contentType || 'application/octet-stream',
      },
      body: bytes,
    })
  } catch (e) {
    throw new Error(`GitHub upload fetch failed: ${url}`, { cause: e })
  }
  const text = await resp.text()
  if (!resp.ok) {
    const err = new Error(`GitHub upload failed: HTTP ${resp.status}\n${text}`)
    err.status = resp.status
    throw err
  }
  return text ? JSON.parse(text) : null
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function shouldRetryError(err) {
  const status = Number(err?.status || 0)
  if (status === 429) return true
  if (status >= 500 && status <= 599) return true

  const msg = String(err?.message || '')
  if (msg.includes('fetch failed')) return true
  if (msg.includes('ECONNRESET')) return true
  if (msg.includes('ETIMEDOUT')) return true
  if (msg.includes('ENOTFOUND')) return true
  if (msg.includes('EAI_AGAIN')) return true
  return false
}

async function withRetry(fn, opts = {}) {
  const attempts = typeof opts.attempts === 'number' ? opts.attempts : 3
  const baseDelayMs = typeof opts.baseDelayMs === 'number' ? opts.baseDelayMs : 800
  let last = null
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (i >= attempts || !shouldRetryError(e)) throw e
      const delay = baseDelayMs * Math.pow(2, i - 1)
      await sleep(delay)
    }
  }
  throw last || new Error('retry failed')
}

function formatError(err) {
  const lines = []
  const status = Number(err?.status || 0)
  const msg = String(err?.message || err || '').trim()
  if (msg) lines.push(msg)
  if (status) lines.push(`HTTP status: ${status}`)

  let c = err?.cause
  let depth = 0
  while (c && depth < 3) {
    const cm = String(c?.message || c || '').trim()
    if (cm) lines.push(`caused by: ${cm}`)
    c = c?.cause
    depth++
  }

  return lines.join('\n')
}

async function ghJson(method, url, token, body) {
  return await withRetry(() => httpJson(method, url, token, body), { attempts: 4, baseDelayMs: 800 })
}

async function ghUpload(url, token, bytes, contentType) {
  return await withRetry(() => httpUpload(url, token, bytes, contentType), { attempts: 4, baseDelayMs: 800 })
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function updateIndexJson(indexPath, nextPlugin) {
  let index = { registry_version: 1, plugins: [] }
  if (indexPath && (await exists(indexPath))) {
    index = await readJson(indexPath)
  }
  if (!index || typeof index !== 'object' || Array.isArray(index)) throw new Error('index.json 格式不合法')
  if (index.registry_version !== 1) throw new Error('不支持的 registry_version（仅支持 1）')
  if (!Array.isArray(index.plugins)) index.plugins = []

  const plugins = index.plugins.filter(Boolean)
  const rest = plugins.filter(p => String(p?.id || '').trim() !== nextPlugin.id)
  rest.push(nextPlugin)
  rest.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  index.plugins = rest

  await fs.mkdir(path.dirname(indexPath), { recursive: true })
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8')
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const out = {
    pluginId: '',
    owner: DEFAULT_OWNER,
    repo: DEFAULT_REPO,
    remote: DEFAULT_REMOTE,
    branch: DEFAULT_BRANCH,
    storeDir: DEFAULT_STORE_DIR,
    outDir: DEFAULT_OUT_DIR,
    noBuild: false,
    dryRun: false,
    all: false,
    force: false,
    message: 'Update index.json',
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') continue
    if (a === '--all') {
      out.all = true
      continue
    }
    if (a === '--plugin' && i + 1 < args.length) {
      out.pluginId = String(args[i + 1] || '').trim()
      i++
      continue
    }
    if (a === '--repo-dir' && i + 1 < args.length) {
      out.storeDir = path.resolve(rootDir, String(args[i + 1] || '').trim())
      i++
      continue
    }
    if (a === '--out' && i + 1 < args.length) {
      out.outDir = path.resolve(rootDir, String(args[i + 1] || '').trim())
      i++
      continue
    }
    if (a === '--remote' && i + 1 < args.length) {
      out.remote = String(args[i + 1] || '').trim()
      i++
      continue
    }
    if (a === '--branch' && i + 1 < args.length) {
      out.branch = String(args[i + 1] || '').trim() || DEFAULT_BRANCH
      i++
      continue
    }
    if (a === '--owner' && i + 1 < args.length) {
      out.owner = String(args[i + 1] || '').trim() || DEFAULT_OWNER
      i++
      continue
    }
    if (a === '--repo' && i + 1 < args.length) {
      out.repo = String(args[i + 1] || '').trim() || DEFAULT_REPO
      i++
      continue
    }
    if (a === '--no-build') {
      out.noBuild = true
      continue
    }
    if (a === '--dry-run') {
      out.dryRun = true
      continue
    }
    if (a === '--force') {
      out.force = true
      continue
    }
    if (a === '--message' && i + 1 < args.length) {
      out.message = String(args[i + 1] || '').trim() || out.message
      i++
      continue
    }
  }

  if (!out.remote) out.remote = `https://github.com/${out.owner}/${out.repo}.git`
  if (out.all && out.pluginId) {
    throw new Error('--all 与 --plugin 互斥，请二选一')
  }
  return out
}

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function isGitRepo(dir) {
  try {
    const st = await fs.stat(path.join(dir, '.git'))
    return st.isDirectory()
  } catch {
    return false
  }
}

async function ensurePluginStoreCloned(opts) {
  const dir = opts.storeDir
  const remote = opts.remote

  if (await isGitRepo(dir)) return

  if (await exists(dir)) {
    // Safety: only auto-remove an empty dir or one that only contains index.json.
    const entries = await fs.readdir(dir).catch(() => [])
    const safeNames = new Set(['index.json', '.DS_Store', 'Thumbs.db'])
    const unknown = entries.filter(n => !safeNames.has(n))
    if (unknown.length > 0) {
      throw new Error(`plugin-store 目录已存在但不是 git 仓库，请先手动清空/删除：${dir}`)
    }
    await fs.rm(dir, { recursive: true, force: true })
  }

  await fs.mkdir(path.dirname(dir), { recursive: true })
  await runInherit('git', ['clone', remote, dir])
}

async function syncPluginStoreRepo(storeDir, branch) {
  // plugin-store 作为分发仓库工作区：脚本运行时保持干净，避免脏状态影响发布判断。
  await runInherit('git', ['-C', storeDir, 'reset', '--hard'])
  await runInherit('git', ['-C', storeDir, 'clean', '-fd'])

  await runInherit('git', ['-C', storeDir, 'fetch', 'origin'])
  try {
    await runInherit('git', ['-C', storeDir, 'checkout', '-B', branch, `origin/${branch}`])
  } catch {
    await runInherit('git', ['-C', storeDir, 'checkout', '-B', branch])
  }
  try {
    await runInherit('git', ['-C', storeDir, 'reset', '--hard', `origin/${branch}`])
  } catch {
    // ok for brand new / empty repos
  }
}

async function gitCommitAndPush(storeDir, branch, message) {
  await runInherit('git', ['-C', storeDir, 'checkout', '-B', branch])
  await runInherit('git', ['-C', storeDir, 'add', '-A'])

  const st = await (async () => {
    const p = run('git', ['-C', storeDir, 'status', '--porcelain=v1'])
    let out = ''
    let err = ''
    p.stdout.on('data', d => { out += String(d) })
    p.stderr.on('data', d => { err += String(d) })
    const code = await new Promise(resolve => p.on('exit', c => resolve(c ?? 0)))
    if (code !== 0) throw new Error(err.trim() || 'git status failed')
    return out.trim()
  })()

  if (!st) return false

  await runInherit('git', ['-C', storeDir, 'commit', '-m', message])
  await runInherit('git', ['-C', storeDir, 'push', '-u', 'origin', branch])
  return true
}

async function listPluginIds() {
  let entries = []
  try {
    entries = await fs.readdir(DEFAULT_PLUGINS_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
  const out = []
  for (const id of dirs) {
    const mp = path.join(DEFAULT_PLUGINS_DIR, id, 'manifest.json')
    if (await exists(mp)) out.push(id)
  }
  out.sort((a, b) => a.localeCompare(b))
  return out
}

async function getLocalManifestVersion(pluginId) {
  const manifestPath = path.join(DEFAULT_PLUGINS_DIR, pluginId, 'manifest.json')
  const manifest = await readJson(manifestPath)
  const version = String(manifest?.version || '').trim()
  if (!version) return ''
  if (!parseSemverStrict(version)) {
    throw new Error(`plugins/${pluginId}/manifest.json 的 version 必须是 x.y.z 格式（SemVer）：${version}`)
  }
  return version
}

async function getPublishedEntry(storeDir, pluginId) {
  const indexPath = path.join(storeDir, 'index.json')
  if (!(await exists(indexPath))) return null
  const index = await readJson(indexPath)
  const plugins = Array.isArray(index?.plugins) ? index.plugins : []
  return plugins.find(p => String(p?.id || '').trim() === pluginId) || null
}

async function checkPublishedVersionPolicy(opts, pluginId) {
  const version = await getLocalManifestVersion(pluginId)
  if (!version) return { status: 'missing', version: '' }

  const existed = await getPublishedEntry(opts.storeDir, pluginId)
  if (!existed) return { status: 'new', version, publishedVersion: '' }

  const publishedVersion = String(existed?.version || '').trim()
  if (!publishedVersion) return { status: 'new', version, publishedVersion: '' }

  const cmp = cmpSemverStrict(version, publishedVersion)
  if (cmp === 0) return { status: 'same', version, publishedVersion }
  if (cmp < 0) return { status: 'downgrade', version, publishedVersion }
  return { status: 'upgrade', version, publishedVersion }
}

async function tryDownloadReleaseAssetAndExtractManifest(url, zipPath, pluginId) {
  const resp = await withRetry(
    () =>
      fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'fast-window-plugin-store' },
      }),
    { attempts: 4, baseDelayMs: 800 },
  )

  if (resp.status === 404) return null
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`下载 release asset 失败: HTTP ${resp.status}\n${text}`)
    err.status = resp.status
    throw err
  }

  await fs.mkdir(path.dirname(zipPath), { recursive: true })
  await fs.rm(zipPath, { force: true })

  const h = crypto.createHash('sha256')
  const tee = new Transform({
    transform(chunk, _enc, cb) {
      try {
        h.update(chunk)
        cb(null, chunk)
      } catch (e) {
        cb(e)
      }
    },
  })

  const out = fssync.createWriteStream(zipPath)
  await pipeline(resp.body, tee, out)
  const sha256 = h.digest('hex')

  const extractDir = path.join(rootDir, '.tmp', `recover-extract-${pluginId}-${Date.now()}`)
  await fs.rm(extractDir, { recursive: true, force: true })
  await fs.mkdir(extractDir, { recursive: true })

  try {
    await runInherit('tar', ['-xf', zipPath, '-C', extractDir])
    const manifestPath = path.join(extractDir, pluginId, 'manifest.json')
    const manifest = await readJson(manifestPath)
    return { sha256, manifest }
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true })
    await fs.rm(zipPath, { force: true })
  }
}

async function maybeRecoverIndexFromExistingReleaseAsset(opts, pluginId) {
  if (opts.force) return false

  const manifestPath = path.join(DEFAULT_PLUGINS_DIR, pluginId, 'manifest.json')
  let local = null
  try {
    local = await readJson(manifestPath)
  } catch {
    return false
  }
  const version = String(local?.version || '').trim()
  if (!version) return false
  if (!parseSemverStrict(version)) {
    throw new Error(`plugins/${pluginId}/manifest.json 的 version 必须是 x.y.z 格式（SemVer）：${version}`)
  }

  const tag = `v${pluginId}-${version}`
  const zipName = `${pluginId}-${version}.zip`
  const downloadUrl = `https://github.com/${opts.owner}/${opts.repo}/releases/download/${tag}/${zipName}`

  const zipPath = path.join(rootDir, '.tmp', 'recover-release-assets', zipName)
  const got = await tryDownloadReleaseAssetAndExtractManifest(downloadUrl, zipPath, pluginId)
  if (!got) return false

  const remoteManifest = got.manifest || {}
  const remoteId = String(remoteManifest?.id || '').trim()
  const remoteVersion = String(remoteManifest?.version || '').trim()
  if (remoteId && remoteId !== pluginId) {
    throw new Error(`release asset manifest.id 不匹配：expected ${pluginId}, got ${remoteId}`)
  }
  if (remoteVersion && remoteVersion !== version) {
    throw new Error(`release asset manifest.version 不匹配：expected ${version}, got ${remoteVersion}`)
  }

  const name = String(remoteManifest?.name || '').trim() || pluginId
  const description = typeof remoteManifest?.description === 'string' ? remoteManifest.description : ''
  const requires = Array.isArray(remoteManifest?.requires)
    ? remoteManifest.requires.map(x => String(x || '').trim()).filter(Boolean)
    : []

  const entry = {
    id: pluginId,
    name,
    description,
    version,
    download_url: downloadUrl,
    sha256: got.sha256,
    requires,
  }

  await updateIndexJson(path.join(opts.storeDir, 'index.json'), entry)
  console.log('[plugin-store] recovered index.json from existing release asset:', downloadUrl)
  return true
}

async function ensureReleaseAndUpload(opts, result) {
  const token = pickToken()
  if (!token) {
    throw new Error('缺少 GitHub Token：请设置环境变量 GITHUB_TOKEN（或 FAST_WINDOW_GITHUB_TOKEN）以便创建 Release 并上传资产')
  }

  const owner = opts.owner
  const repo = opts.repo
  const tag = String(result.tag || '').trim()
  const zipPath = String(result.zipPath || '').trim()
  const zipName = path.basename(zipPath)
  if (!tag) throw new Error('missing tag from publish result')
  if (!zipPath) throw new Error('missing zipPath from publish result')

  const apiBase = `https://api.github.com/repos/${owner}/${repo}`
  const getUrl = `${apiBase}/releases/tags/${encodeURIComponent(tag)}`

  let release = null
  try {
    release = await ghJson('GET', getUrl, token, null)
  } catch (e) {
    if (Number(e?.status || 0) !== 404) throw e
  }

  if (!release) {
    release = await ghJson('POST', `${apiBase}/releases`, token, {
      tag_name: tag,
      name: tag,
      body: `Automated plugin release for ${result.pluginId} ${result.version}`,
      draft: false,
      prerelease: false,
    })
  }

  const uploadUrl = String(release.upload_url || '').split('{')[0]
  if (!uploadUrl) throw new Error('GitHub API did not return upload_url')

  const assets = Array.isArray(release.assets) ? release.assets : []
  const existed = assets.find(a => String(a?.name || '') === zipName) || null
  if (existed && existed.id) {
    try {
      await ghJson('DELETE', `${apiBase}/releases/assets/${existed.id}`, token, null)
    } catch (e) {
      if (Number(e?.status || 0) !== 404) throw e
    }
  }

  const bytes = await fs.readFile(zipPath)
  await ghUpload(`${uploadUrl}?name=${encodeURIComponent(zipName)}`, token, bytes, 'application/zip')
  return release.html_url || ''
}

async function main() {
  await loadDotEnvIfPresent()

  const opts = parseArgs(process.argv)
  if (!opts.all && !opts.pluginId) {
    console.error('Usage: node scripts/publish-plugin-to-download.mjs (--plugin <id> | --all) [--dry-run] [--no-build] [--force]')
    process.exitCode = 2
    return
  }

  await ensurePluginStoreCloned(opts)
  await syncPluginStoreRepo(opts.storeDir, opts.branch)

  const pluginIds = opts.all ? await listPluginIds() : [opts.pluginId]
  if (pluginIds.length === 0) {
    console.log('[plugin-store] 没有发现可发布插件')
    return
  }

  const failed = []
  for (const pluginId of pluginIds) {
    console.log(`\n==== publish ${pluginId} ====`)
    try {
      const policy = await checkPublishedVersionPolicy(opts, pluginId)
      if (policy?.status === 'missing') {
        throw new Error(`plugins/${pluginId}/manifest.json 缺少 version`)
      }

      if (policy?.status === 'same' && !opts.force) {
        if (opts.all) {
          console.log(`[plugin-store] skip: 已发布同版本（严禁覆盖）：${pluginId}@${policy.version}`)
          continue
        }
        throw new Error(
          `该版本已发布，严禁覆盖：${pluginId}@${policy.version}\n` +
            `请修改 plugins/${pluginId}/manifest.json 的 version 字段进行版本升级；如必须覆盖，显式传入 --force。`,
        )
      }
      if (policy?.status === 'same' && opts.force) {
        console.warn(`[plugin-store] WARNING: --force 已启用，将覆盖已发布版本：${pluginId}@${policy.version}`)
      }

      if (policy?.status === 'downgrade' && !opts.force) {
        throw new Error(
          `版本号必须严格递增（SemVer）：${pluginId}\n` +
            `云端=${policy.publishedVersion}，本地=${policy.version}\n` +
            `请提升 plugins/${pluginId}/manifest.json 的 version；如必须覆盖，显式传入 --force。`,
        )
      }
      if (policy?.status === 'downgrade' && opts.force) {
        console.warn(
          `[plugin-store] WARNING: --force 已启用，将发布非递增/降级版本：${pluginId} ${policy.publishedVersion} -> ${policy.version}`,
        )
      }

      if (policy?.status !== 'same' && (await maybeRecoverIndexFromExistingReleaseAsset(opts, pluginId))) {
        if (opts.dryRun) {
          console.log('[plugin-store] dry-run: recovered index (no push)')
          continue
        }
        const pushed = await gitCommitAndPush(opts.storeDir, opts.branch, `${opts.message} (${pluginId})`)
        if (pushed) console.log('[plugin-store] pushed index.json:', opts.remote)
        else console.log('[plugin-store] index.json unchanged')
        continue
      }

      const jsonOutPath = path.join(rootDir, '.tmp', `publish-result-${pluginId}.json`)

      const realIndexPath = path.join(opts.storeDir, 'index.json')
      const indexPathForPublish = opts.dryRun
        ? path.join(rootDir, '.tmp', `dry-run-index-${pluginId}.json`)
        : realIndexPath
      if (opts.dryRun && (await exists(realIndexPath))) {
        await fs.mkdir(path.dirname(indexPathForPublish), { recursive: true })
        await fs.copyFile(realIndexPath, indexPathForPublish)
      }

      const publishArgs = [
        path.join(rootDir, 'scripts', 'publish-plugin.mjs'),
        '--plugin',
        pluginId,
        '--out',
        opts.outDir,
        '--index',
        indexPathForPublish,
        '--json-file',
        jsonOutPath,
      ]
      if (opts.noBuild) publishArgs.push('--no-build')

      await runInherit(process.execPath, publishArgs, { cwd: rootDir })
      const resultRaw = await fs.readFile(jsonOutPath, 'utf8')
      const result = JSON.parse(resultRaw || '{}')

      if (opts.dryRun) {
        console.log('[plugin-store] dry-run: publish ok')
        console.log(JSON.stringify({ tag: result.tag, zipPath: result.zipPath, indexPath: result.indexPath }, null, 2))
        continue
      }

      // 一致性优先：先确保 Release + asset 上传成功，再提交并 push index.json。
      const url = await ensureReleaseAndUpload(opts, result)
      console.log('[plugin-store] release:', url || '(created)')

      const pushed = await gitCommitAndPush(opts.storeDir, opts.branch, `${opts.message} (${pluginId})`)
      if (pushed) console.log('[plugin-store] pushed index.json:', opts.remote)
      else console.log('[plugin-store] index.json unchanged')
    } catch (e) {
      console.error(formatError(e))
      failed.push(pluginId)
    }
  }

  if (failed.length > 0) {
    throw new Error(`以下插件发布失败：\n- ${failed.join('\n- ')}`)
  }
}

await main().catch(err => {
  console.error(formatError(err))
  process.exitCode = 1
})
