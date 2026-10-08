import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { sha256FileHex } from './v5-app-packaging.mjs'

export const manifestFileName = 'fw-app.json'
export const appTypes = new Set(['desktop-app', 'service-app'])
export const catalogIconMaxDataUrlLength = 200000
export const safeIDPattern = /^[A-Za-z0-9_-]+$/
export const displayModes = new Set(['default', 'window', 'top'])
export const iconMimeByExtension = new Map([
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
])

export function readManifest(protocolDir) {
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

export function manifestFacts(manifest) {
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
    executable: manifest?.package?.windowsExecutable,
    icon: manifest?.package?.icon,
    displayMode,
    commands,
  }
}

export function readVersion(root, versionSource) {
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

export function buildCatalogIcon(root, iconRel) {
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

export async function artifactFacts(artifactPath) {
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

export function normalizeRelativePath(value, field) {
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
