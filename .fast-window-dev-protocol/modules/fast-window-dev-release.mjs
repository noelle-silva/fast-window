import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { cleanupUploadedReleaseAsset, ensureReleaseAsset } from './github-release-assets.mjs'
import { assertV5AppPublishVersionPolicy } from './v5-app-publishing.mjs'
import { sha256FileHex, upsertStoreApp } from './v5-app-packaging.mjs'
import {
  DEFAULT_DOWNLOAD_BRANCH,
  DEFAULT_DOWNLOAD_OWNER,
  DEFAULT_DOWNLOAD_REPO,
  V5_STORE_CATALOG_FILE,
  assertWritableToken,
  loadCatalogOrMigrateIndex,
  loadProtocolEnv,
  pickGithubToken,
  writeRemoteJsonFile,
} from './v5-download-store.mjs'

const manifestFileName = 'fw-app.json'
const appTypes = new Set(['desktop-app', 'service-app'])
const catalogIconMaxDataUrlLength = 200000
const safeIDPattern = /^[A-Za-z0-9_-]+$/
const displayModes = new Set(['default', 'window', 'top'])
const iconMimeByExtension = new Map([
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
])

// 发布边界：manifest 读应用协议目录，凭据只读中央协议目录，应用侧不持有发布凭据。
export async function publishArtifactToStore({ protocolDir, credentialsDir, artifactPath }) {
  if (String(credentialsDir ?? '').trim() === '') {
    throw new Error('缺少发布凭据目录：发布模式必须由中央工具传入主仓库协议目录路径')
  }
  const root = path.dirname(path.resolve(protocolDir))
  const artifact = await artifactFacts(artifactPath)
  const manifest = manifestFacts(readManifest(protocolDir))
  const version = readVersion(root, manifest.versionSource)
  const icon = buildCatalogIcon(root, manifest.icon)
  await loadProtocolEnv(credentialsDir)

  const options = {
    owner: DEFAULT_DOWNLOAD_OWNER,
    repo: DEFAULT_DOWNLOAD_REPO,
    branch: DEFAULT_DOWNLOAD_BRANCH,
    force: false,
    appId: manifest.id,
    message: 'Update catalog.json',
  }
  const authToken = pickGithubToken()
  if (!authToken) {
    throw new Error('缺少发布凭据：请在中央协议目录 .fast-window-dev-protocol/.env 或环境变量中提供 GITHUB_TOKEN')
  }
  await assertWritableToken(options, authToken)
  const remote = await loadCatalogOrMigrateIndex(options, authToken, 'api')
  assertV5AppPublishVersionPolicy(remote.catalog, manifest.id, version, options.force)

  const tag = `v${manifest.id}-${version}`
  const downloadUrl = `https://github.com/${options.owner}/${options.repo}/releases/download/${tag}/${artifact.fileName}`
  const catalogEntry = {
    type: manifest.type,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version,
    icon,
    platforms: {
      windows: { downloadUrl, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
    },
    displayMode: manifest.displayMode,
    commands: manifest.commands,
  }

  const release = await ensureReleaseAsset(options, {
    tag,
    name: tag,
    body: `Automated release for ${manifest.id} ${version}`,
    assetName: artifact.fileName,
    assetPath: artifact.path,
    contentType: 'application/zip',
  }, authToken)

  let catalogCommitUrl = ''
  try {
    const nextCatalog = upsertStoreApp(remote.catalog, catalogEntry)
    catalogCommitUrl = await writeRemoteJsonFile(options, V5_STORE_CATALOG_FILE, remote.catalogSha, nextCatalog, authToken)
  } catch (error) {
    try {
      await cleanupUploadedReleaseAsset(options, release, authToken)
    } catch (cleanupError) {
      throw new Error(`商店目录更新失败，且远端清理失败。写回错误：${error?.message || error}；清理错误：${cleanupError?.message || cleanupError}`)
    }
    throw error
  }

  return {
    appId: manifest.id,
    version,
    tag,
    fileName: artifact.fileName,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    releaseUrl: release.releaseUrl,
    assetUrl: release.assetUrl,
    catalogUrl: `https://raw.githubusercontent.com/${options.owner}/${options.repo}/${options.branch}/${V5_STORE_CATALOG_FILE}`,
    catalogCommitUrl,
  }
}

function readManifest(protocolDir) {
  const manifestPath = path.join(protocolDir, manifestFileName)
  if (!existsSync(manifestPath)) {
    throw new Error(`找不到应用清单：${manifestFileName}`)
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`解析应用清单失败：${error.message}`)
  }
}

function manifestFacts(manifest) {
  const type = String(manifest?.type ?? '').trim()
  if (!appTypes.has(type)) {
    throw new Error(`清单 type 必须为 desktop-app 或 service-app：${type || '(empty)'}`)
  }
  const id = String(manifest?.id ?? '').trim()
  if (!safeIDPattern.test(id)) {
    throw new Error(`清单 id 不合法：${id}`)
  }
  const name = String(manifest?.name ?? '').trim()
  if (name === '') {
    throw new Error('清单 name 不能为空')
  }
  const description = String(manifest?.description ?? '').trim()
  if (description === '') {
    throw new Error('清单 description 不能为空')
  }
  const displayMode = String(manifest?.displayMode ?? '').trim()
  if (!displayModes.has(displayMode)) {
    throw new Error('清单 displayMode 必须为 default、window 或 top')
  }
  const commands = (Array.isArray(manifest?.commands) ? manifest.commands : []).map((item, index) => {
    const commandId = String(item?.id ?? '').trim()
    const title = String(item?.title ?? '').trim()
    if (!safeIDPattern.test(commandId) || title === '') {
      throw new Error(`清单 commands[${index}] 不合法`)
    }
    return { id: commandId, title }
  })
  return {
    type,
    id,
    name,
    description,
    versionSource: manifest?.versionSource,
    icon: manifest?.package?.icon,
    displayMode,
    commands,
  }
}

function readVersion(root, versionSource) {
  const source = normalizeRelativePath(versionSource, 'versionSource')
  const file = path.join(root, source)
  let payload
  try {
    payload = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`读取 versionSource 失败：${error.message}`)
  }
  const version = String(payload?.version ?? '').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`versionSource 版本无效：${version || '(empty)'}`)
  }
  return version
}

function buildCatalogIcon(root, iconRel) {
  const icon = normalizeRelativePath(iconRel, 'package.icon')
  const mime = iconMimeByExtension.get(path.extname(icon).toLowerCase())
  if (!mime) {
    throw new Error('清单 package.icon 只支持 .png 或 .svg 图标')
  }
  const file = path.join(root, icon)
  if (!existsSync(file)) {
    throw new Error(`图标文件不存在：${icon}`)
  }
  const dataUrl = `data:${mime};base64,${readFileSync(file).toString('base64')}`
  if (dataUrl.length > catalogIconMaxDataUrlLength) {
    throw new Error(`图标转为商店图标后过大：${icon}`)
  }
  return { type: 'data', dataUrl }
}

async function artifactFacts(artifactPath) {
  const value = String(artifactPath ?? '').trim()
  if (value === '') {
    throw new Error('缺少成品路径')
  }
  const source = path.resolve(value)
  let info
  try {
    info = statSync(source)
  } catch {
    throw new Error(`成品文件不存在：${source}`)
  }
  if (!info.isFile() || info.size === 0) {
    throw new Error(`成品必须是有效文件：${source}`)
  }
  return {
    path: source,
    fileName: path.basename(source),
    sizeBytes: info.size,
    sha256: await sha256FileHex(source),
  }
}

function normalizeRelativePath(value, field) {
  const normalized = String(value ?? '').trim().replaceAll('\\', '/')
  if (normalized === '') {
    throw new Error(`${field} 不能为空`)
  }
  if (path.isAbsolute(normalized) || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`${field} 不允许是绝对路径：${normalized}`)
  }
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`${field} 不安全：${normalized}`)
    }
  }
  return normalized
}
