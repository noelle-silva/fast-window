import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const manifestFileName = 'fw-app.json'
export const appTypes = new Set(['desktop-app', 'service-app'])
export const catalogIconMaxDataUrlLength = 200000
export const iconMimeByExtension = new Map([
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
])

// 商店值规则：应用 id 与版本号在清单、商店目录、远程提交中共用同一份判定。
export function isSafeId(value) {
  return /^[A-Za-z0-9_-]+$/.test(String(value ?? '').trim())
}

// 合法时返回去空白后的版本号，不合法时返回空串。
export function parseSemverStrict(raw) {
  const value = String(raw ?? '').trim()
  return /^\d+\.\d+\.\d+$/.test(value) ? value : ''
}

export function compareSemverStrict(left, right) {
  if (!parseSemverStrict(left) || !parseSemverStrict(right)) {
    throw new Error(`版本号必须是 x.y.z 格式: ${left} / ${right}`)
  }
  const a = String(left).trim().split('.').map(Number)
  const b = String(right).trim().split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

export function sha256FileHex(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

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
  if (!isSafeId(id)) {
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
  const commands = (Array.isArray(manifest?.commands) ? manifest.commands : []).map((item, index) => {
    const commandId = String(item?.id ?? '').trim()
    const title = String(item?.title ?? '').trim()
    if (!isSafeId(commandId) || title === '') {
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
  const version = parseSemverStrict(payload?.version)
  if (!version) {
    throw new Error(`versionSource 版本无效：${String(payload?.version ?? '').trim() || '(empty)'}`)
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
