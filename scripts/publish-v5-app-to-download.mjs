import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  DEFAULT_V5_APP_OUT_DIR,
  buildV5AppPackage,
  compareSemverStrict,
  getV5AppConfig,
  isSafeId,
  loadV5AppVersion,
  parseSemverStrict,
  rootDir,
  upsertStoreApp,
  writeV5StoreCatalog,
} from './lib/v5-app-packaging.mjs'

const DEFAULT_OWNER = 'noelle-silva'
const DEFAULT_REPO = 'fast-window-plugins-download'
const DEFAULT_BRANCH = 'main'
const CATALOG_FILE = 'catalog.json'
const INDEX_FILE = 'index.json'

function parseArgs(argv) {
  const out = {
    appId: '',
    owner: DEFAULT_OWNER,
    repo: DEFAULT_REPO,
    branch: DEFAULT_BRANCH,
    outDir: DEFAULT_V5_APP_OUT_DIR,
    noBuild: false,
    dryRun: false,
    force: false,
    message: 'Update catalog.json',
  }
  const args = argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--app' && i + 1 < args.length) out.appId = String(args[++i] || '').trim()
    else if (arg === '--owner' && i + 1 < args.length) out.owner = String(args[++i] || '').trim() || DEFAULT_OWNER
    else if (arg === '--repo' && i + 1 < args.length) out.repo = String(args[++i] || '').trim() || DEFAULT_REPO
    else if (arg === '--branch' && i + 1 < args.length) out.branch = String(args[++i] || '').trim() || DEFAULT_BRANCH
    else if (arg === '--out' && i + 1 < args.length) out.outDir = path.resolve(rootDir, String(args[++i] || '').trim())
    else if (arg === '--message' && i + 1 < args.length) out.message = String(args[++i] || '').trim() || out.message
    else if (arg === '--no-build') out.noBuild = true
    else if (arg === '--dry-run') out.dryRun = true
    else if (arg === '--force') out.force = true
  }
  if (!out.appId) throw new Error('Usage: node scripts/publish-v5-app-to-download.mjs --app <id> [--dry-run] [--no-build] [--force]')
  if (!isSafeId(out.appId)) throw new Error(`app id 不合法: ${out.appId}`)
  return out
}

async function loadDotEnvIfPresent() {
  for (const filePath of [path.join(rootDir, '.env.local'), path.join(rootDir, '.env')]) {
    let raw = ''
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch {
      continue
    }
    for (const line0 of raw.split(/\r?\n/g)) {
      const line = String(line0 || '').trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue
      let value = line.slice(idx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      process.env[key] = value
    }
  }
}

function pickToken() {
  return (process.env.GITHUB_TOKEN || '').trim() || (process.env.FAST_WINDOW_GITHUB_TOKEN || '').trim() || (process.env.GH_TOKEN || '').trim()
}

function githubHeaders(authToken, extra = {}) {
  return {
    'User-Agent': 'fast-window-v5-app-store',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...extra,
  }
}

async function githubJson(method, url, authToken, body = undefined) {
  const resp = await fetch(url, {
    method,
    headers: githubHeaders(authToken, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await resp.text()
  if (!resp.ok) {
    const error = new Error(`GitHub API ${method} ${url} failed: HTTP ${resp.status}\n${text}`)
    error.status = resp.status
    throw error
  }
  return text ? JSON.parse(text) : null
}

async function assertWritableToken(opts, authToken) {
  if (!authToken) throw new Error('缺少 GitHub Token：请设置 GITHUB_TOKEN、FAST_WINDOW_GITHUB_TOKEN 或 GH_TOKEN')
  try {
    await githubJson('GET', repoApiBase(opts), authToken)
  } catch (error) {
    if (Number(error?.status || 0) === 401) {
      throw new Error('GitHub Token 无效或已过期：请更新 GITHUB_TOKEN、FAST_WINDOW_GITHUB_TOKEN 或 GH_TOKEN')
    }
    throw error
  }
}

async function githubUpload(url, authToken, bytes, contentType) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: githubHeaders(authToken, { 'Content-Type': contentType }),
    body: bytes,
  })
  const text = await resp.text()
  if (!resp.ok) {
    const error = new Error(`GitHub upload failed: HTTP ${resp.status}\n${text}`)
    error.status = resp.status
    throw error
  }
  return text ? JSON.parse(text) : null
}

function repoApiBase(opts) {
  return `https://api.github.com/repos/${opts.owner}/${opts.repo}`
}

async function readRemoteJsonFile(opts, fileName, authToken) {
  const url = `${repoApiBase(opts)}/contents/${encodeURIComponent(fileName)}?ref=${encodeURIComponent(opts.branch)}`
  let data = null
  try {
    data = await githubJson('GET', url, authToken)
  } catch (error) {
    if (Number(error?.status || 0) === 404) return null
    throw error
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${fileName} GitHub contents 响应格式不合法`)
  if (String(data.encoding || '') !== 'base64') throw new Error(`${fileName} GitHub contents 不是 base64 编码`)
  const raw = Buffer.from(String(data.content || '').replace(/\s/g, ''), 'base64').toString('utf8')
  return { json: JSON.parse(raw), sha: String(data.sha || '').trim() }
}

async function readPublicRemoteJsonFile(opts, fileName) {
  const url = `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch}/${fileName}`
  const resp = await fetch(url, { headers: { 'User-Agent': 'fast-window-v5-app-store' } })
  if (resp.status === 404) return null
  const text = await resp.text()
  if (!resp.ok) throw new Error(`读取公开 ${fileName} 失败: HTTP ${resp.status}\n${text}`)
  return { json: JSON.parse(text), sha: '' }
}

async function writeRemoteJsonFile(opts, fileName, sha, value, authToken) {
  const body = {
    message: `${opts.message} (${opts.appId})`,
    content: Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8').toString('base64'),
    branch: opts.branch,
    ...(sha ? { sha } : {}),
  }
  const result = await githubJson('PUT', `${repoApiBase(opts)}/contents/${encodeURIComponent(fileName)}`, authToken, body)
  return String(result?.commit?.html_url || '').trim()
}

function normalizeLegacyIcon(icon) {
  const raw = String(icon || '').trim()
  if (raw.startsWith('data:image/')) return { type: 'data', dataUrl: raw }
  if (raw.startsWith('https://')) return { type: 'url', url: raw }
  if (raw.length > 0 && raw.length <= 8) return { type: 'emoji', value: raw }
  return undefined
}

function convertLegacyPlugin(plugin) {
  const id = String(plugin?.id || '').trim()
  const name = String(plugin?.name || '').trim()
  const description = typeof plugin?.description === 'string' ? plugin.description : ''
  const version = String(plugin?.version || '').trim()
  const downloadUrl = String(plugin?.download_url || plugin?.downloadUrl || '').trim()
  const sha256 = String(plugin?.sha256 || '').trim().toLowerCase()
  if (!isSafeId(id)) throw new Error(`legacy plugin id 不合法: ${id}`)
  if (!name) throw new Error(`legacy plugin name 缺失: ${id}`)
  if (!parseSemverStrict(version)) throw new Error(`legacy plugin version 不合法: ${id}@${version}`)
  if (!downloadUrl.startsWith('https://')) throw new Error(`legacy plugin downloadUrl 必须是 https: ${id}`)
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`legacy plugin sha256 不合法: ${id}`)
  const requires = Array.isArray(plugin?.requires) ? plugin.requires.map(x => String(x || '').trim()).filter(Boolean).sort() : []
  const icon = typeof plugin?.icon === 'string' ? normalizeLegacyIcon(plugin.icon) : undefined
  return { id, name, description, ...(icon ? { icon } : {}), version, downloadUrl, sha256, requires }
}

function assertCatalogShape(catalog, label) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error(`${label} 必须是对象`)
  if (catalog.catalogVersion !== 2) throw new Error(`${label}.catalogVersion 必须为 2`)
  if (!Array.isArray(catalog.apps)) throw new Error(`${label}.apps 必须是数组`)
  if (!Array.isArray(catalog.plugins)) throw new Error(`${label}.plugins 必须是数组`)
}

async function loadCatalogOrMigrateIndex(opts, authToken, mode) {
  const readFile = mode === 'public' ? fileName => readPublicRemoteJsonFile(opts, fileName) : fileName => readRemoteJsonFile(opts, fileName, authToken)
  const catalogFile = await readFile(CATALOG_FILE)
  if (catalogFile) {
    assertCatalogShape(catalogFile.json, CATALOG_FILE)
    return { catalog: catalogFile.json, catalogSha: catalogFile.sha, source: CATALOG_FILE }
  }

  const indexFile = await readFile(INDEX_FILE)
  if (!indexFile) return { catalog: { catalogVersion: 2, apps: [], plugins: [] }, catalogSha: '', source: 'empty' }
  const index = indexFile.json
  if (!index || typeof index !== 'object' || Array.isArray(index)) throw new Error(`${INDEX_FILE} 必须是对象`)
  if (index.registry_version !== 1) throw new Error(`${INDEX_FILE}.registry_version 必须为 1`)
  const plugins = Array.isArray(index.plugins) ? index.plugins.map(convertLegacyPlugin) : []
  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return { catalog: { catalogVersion: 2, apps: [], plugins }, catalogSha: '', source: INDEX_FILE }
}

function findPublishedApp(catalog, appId) {
  return catalog.apps.find(app => String(app?.id || '').trim() === appId) || null
}

function assertVersionPolicy(catalog, appId, version, force) {
  const published = findPublishedApp(catalog, appId)
  if (!published) return
  const publishedVersion = String(published.version || '').trim()
  const cmp = compareSemverStrict(version, publishedVersion)
  if (cmp === 0 && !force) throw new Error(`该 v5 app 版本已发布，严禁覆盖: ${appId}@${version}。如必须覆盖，请显式传入 --force。`)
  if (cmp < 0 && !force) throw new Error(`v5 app 版本号必须递增: ${appId} 云端=${publishedVersion} 本地=${version}。如必须覆盖，请显式传入 --force。`)
}

async function listReleaseAssets(apiBase, releaseId, authToken) {
  const assets = []
  for (let page = 1; page <= 10; page++) {
    const batch = await githubJson('GET', `${apiBase}/releases/${releaseId}/assets?per_page=100&page=${page}`, authToken)
    if (!Array.isArray(batch)) throw new Error('GitHub release assets 响应格式不合法')
    assets.push(...batch)
    if (batch.length < 100) break
  }
  return assets
}

async function ensureReleaseAndUpload(opts, result, authToken) {
  const apiBase = repoApiBase(opts)
  let release = null
  try {
    release = await githubJson('GET', `${apiBase}/releases/tags/${encodeURIComponent(result.tag)}`, authToken)
  } catch (error) {
    if (Number(error?.status || 0) !== 404) throw error
  }
  if (!release) {
    release = await githubJson('POST', `${apiBase}/releases`, authToken, {
      tag_name: result.tag,
      name: result.tag,
      body: `Automated v5 app release for ${result.appId} ${result.version}`,
      draft: false,
      prerelease: false,
    })
  }

  const uploadUrl = String(release.upload_url || '').split('{')[0]
  const releaseId = Number(release.id || 0)
  if (!uploadUrl || !releaseId) throw new Error('GitHub API release 响应缺少 upload_url 或 id')
  const assets = await listReleaseAssets(apiBase, releaseId, authToken)
  const existed = assets.find(asset => String(asset?.name || '') === result.zipName)
  if (existed?.id) await githubJson('DELETE', `${apiBase}/releases/assets/${existed.id}`, authToken)
  const uploaded = await githubUpload(`${uploadUrl}?name=${encodeURIComponent(result.zipName)}`, authToken, await fs.readFile(result.zipPath), 'application/zip')
  return {
    releaseUrl: String(release.html_url || '').trim(),
    assetUrl: String(uploaded?.browser_download_url || '').trim(),
  }
}

async function main() {
  await loadDotEnvIfPresent()
  const opts = parseArgs(process.argv)
  const authToken = pickToken()
  if (!opts.dryRun) await assertWritableToken(opts, authToken)
  const config = getV5AppConfig(opts.appId)
  const version = await loadV5AppVersion(config)
  const tag = `v${opts.appId}-${version}`
  const baseUrl = `https://github.com/${opts.owner}/${opts.repo}/releases/download/${tag}`
  const remote = await loadCatalogOrMigrateIndex(opts, authToken, opts.dryRun ? 'public' : 'api')
  assertVersionPolicy(remote.catalog, opts.appId, version, opts.force)

  const result = await buildV5AppPackage(config, { outDir: opts.outDir, baseUrl, noBuild: opts.noBuild })
  result.tag = tag

  const nextCatalog = upsertStoreApp(remote.catalog, result.catalogEntry)
  const catalogPath = path.join(opts.outDir, 'catalog.release.json')
  await writeV5StoreCatalog(catalogPath, nextCatalog)

  if (opts.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      appId: result.appId,
      version: result.version,
      tag: result.tag,
      zipPath: result.zipPath,
      catalogPath,
      catalogSource: remote.source,
      downloadUrl: result.downloadUrl,
    }, null, 2))
    return
  }

  const release = await ensureReleaseAndUpload(opts, result, authToken)
  const commitUrl = await writeRemoteJsonFile(opts, CATALOG_FILE, remote.catalogSha, nextCatalog, authToken)

  console.log(JSON.stringify({
    appId: result.appId,
    version: result.version,
    tag: result.tag,
    releaseUrl: release.releaseUrl,
    assetUrl: release.assetUrl,
    zipName: result.zipName,
    zipPath: result.zipPath,
    sha256: result.sha256,
    sizeBytes: result.sizeBytes,
    catalogPath,
    catalogUrl: `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch}/${CATALOG_FILE}`,
    catalogCommitUrl: commitUrl,
  }, null, 2))
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
