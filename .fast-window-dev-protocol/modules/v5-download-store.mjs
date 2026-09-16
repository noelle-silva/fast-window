import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { isSafeId, parseSemverStrict, rootDir } from './v5-app-package-manifest.mjs'

export const DEFAULT_DOWNLOAD_OWNER = 'noelle-silva'
export const DEFAULT_DOWNLOAD_REPO = 'fast-window-plugins-download'
export const DEFAULT_DOWNLOAD_BRANCH = 'main'
export const V5_STORE_CATALOG_FILE = 'catalog.json'
export const LEGACY_PLUGIN_INDEX_FILE = 'index.json'

export async function loadDotEnvIfPresent() {
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

export function pickGithubToken() {
  return (process.env.GITHUB_TOKEN || '').trim() || (process.env.FAST_WINDOW_GITHUB_TOKEN || '').trim() || (process.env.GH_TOKEN || '').trim()
}

export function repoApiBase(opts) {
  return `https://api.github.com/repos/${opts.owner}/${opts.repo}`
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

export async function githubJson(method, url, authToken, body = undefined) {
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

export async function assertWritableToken(opts, authToken) {
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

export async function githubUpload(url, authToken, bytes, contentType) {
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

export async function readRemoteJsonFile(opts, fileName, authToken) {
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

export async function readPublicRemoteJsonFile(opts, fileName) {
  const url = `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch}/${fileName}`
  const resp = await fetch(url, { headers: { 'User-Agent': 'fast-window-v5-app-store' } })
  if (resp.status === 404) return null
  const text = await resp.text()
  if (!resp.ok) throw new Error(`读取公开 ${fileName} 失败: HTTP ${resp.status}\n${text}`)
  return { json: JSON.parse(text), sha: '' }
}

function commitMessage(opts) {
  const message = String(opts.message || '').trim()
  const appId = String(opts.appId || '').trim()
  if (!message) throw new Error('commit message 不能为空')
  if (!isSafeId(appId)) throw new Error(`app id 不合法: ${appId || '(empty)'}`)
  return `${message} (${appId})`
}

export async function writeRemoteJsonFile(opts, fileName, sha, value, authToken) {
  const body = {
    message: commitMessage(opts),
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

export function assertCatalogShape(catalog, label) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error(`${label} 必须是对象`)
  if (catalog.catalogVersion !== 2) throw new Error(`${label}.catalogVersion 必须为 2`)
  if (!Array.isArray(catalog.apps)) throw new Error(`${label}.apps 必须是数组`)
  if (!Array.isArray(catalog.plugins)) throw new Error(`${label}.plugins 必须是数组`)
}

export async function loadCatalogOrMigrateIndex(opts, authToken, mode) {
  if (mode !== 'public' && mode !== 'api') throw new Error(`未知 catalog 读取模式: ${mode}`)
  const readFile = mode === 'public' ? fileName => readPublicRemoteJsonFile(opts, fileName) : fileName => readRemoteJsonFile(opts, fileName, authToken)
  const catalogFile = await readFile(V5_STORE_CATALOG_FILE)
  if (catalogFile) {
    assertCatalogShape(catalogFile.json, V5_STORE_CATALOG_FILE)
    return { catalog: catalogFile.json, catalogSha: catalogFile.sha, source: V5_STORE_CATALOG_FILE }
  }

  const indexFile = await readFile(LEGACY_PLUGIN_INDEX_FILE)
  if (!indexFile) return { catalog: { catalogVersion: 2, apps: [], plugins: [] }, catalogSha: '', source: 'empty' }
  const index = indexFile.json
  if (!index || typeof index !== 'object' || Array.isArray(index)) throw new Error(`${LEGACY_PLUGIN_INDEX_FILE} 必须是对象`)
  if (index.registry_version !== 1) throw new Error(`${LEGACY_PLUGIN_INDEX_FILE}.registry_version 必须为 1`)
  const plugins = Array.isArray(index.plugins) ? index.plugins.map(convertLegacyPlugin) : []
  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return { catalog: { catalogVersion: 2, apps: [], plugins }, catalogSha: '', source: LEGACY_PLUGIN_INDEX_FILE }
}
