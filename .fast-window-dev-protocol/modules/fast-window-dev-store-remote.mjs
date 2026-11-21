// 远程商店：GitHub 下载仓库上的商店目录读写、令牌装载与校验。

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { assertStoreCatalogShape } from './fast-window-dev-store-catalog.mjs'
import { isSafeId } from './fast-window-dev-store-common.mjs'

export const DEFAULT_DOWNLOAD_OWNER = 'noelle-silva'
export const DEFAULT_DOWNLOAD_REPO = 'fast-window-plugins-download'
export const DEFAULT_DOWNLOAD_BRANCH = 'main'
export const STORE_CATALOG_FILE = 'catalog.json'

// 把协议目录内的 .env.local / .env 读入进程环境；已存在的变量不被覆盖。
export async function loadProtocolEnv(protocolDir) {
  for (const filePath of [path.join(protocolDir, '.env.local'), path.join(protocolDir, '.env')]) {
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

// 读取远程商店目录：public 走公开地址（预演用，无需令牌），api 走带令牌接口（拿到写回所需的 sha）。
export async function loadRemoteCatalog(opts, authToken, mode) {
  if (mode !== 'public' && mode !== 'api') throw new Error(`未知 catalog 读取模式: ${mode}`)
  const file = mode === 'public'
    ? await readPublicRemoteJsonFile(opts, STORE_CATALOG_FILE)
    : await readRemoteJsonFile(opts, STORE_CATALOG_FILE, authToken)
  if (!file) throw new Error(`远程商店缺少 ${STORE_CATALOG_FILE}：${opts.owner}/${opts.repo}@${opts.branch}`)
  assertStoreCatalogShape(file.json, STORE_CATALOG_FILE)
  return { catalog: file.json, catalogSha: file.sha }
}
