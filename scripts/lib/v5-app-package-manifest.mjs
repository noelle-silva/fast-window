import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const rootDir = path.resolve(__dirname, '..', '..')
export const V5_APP_PACKAGE_MANIFEST_FILE = 'fw-app.package.json'
export const V5_APP_PACKAGE_SCHEMA_VERSION = 2
export const DEFAULT_V5_APP_PROFILE = 'release'
export const V5_APP_PROFILE_IDS = ['release', 'dev']

const APP_DISPLAY_MODES = new Set(['default', 'window', 'top'])
const CATALOG_ICON_TYPES = new Set(['emoji', 'url', 'data'])

export function isSafeId(id) {
  return /^[A-Za-z0-9_-]+$/.test(String(id || '').trim())
}

export function isV5AppProfile(profile) {
  return V5_APP_PROFILE_IDS.includes(String(profile || '').trim())
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

export function normalizeRel(raw, field) {
  const rel = String(raw || '').trim().replaceAll('\\', '/')
  if (!rel) throw new Error(`${field} 不能为空`)
  if (path.isAbsolute(rel)) throw new Error(`${field} 不允许是绝对路径: ${rel}`)
  const parts = rel.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`${field} 不安全: ${rel}`)
  return rel
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function assertPlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 必须是对象`)
  return value
}

function assertKnownKeys(value, field, allowed) {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${field}.${key} 不是受支持字段`)
  }
}

function requiredString(value, field, maxLength = 240) {
  const out = String(value || '').trim()
  if (!out) throw new Error(`${field} 不能为空`)
  if (out.length > maxLength) throw new Error(`${field} 长度不能超过 ${maxLength}`)
  return out
}

function validateBuildCommand(value, field) {
  const build = assertPlainObject(value, field)
  assertKnownKeys(build, field, ['command', 'args'])
  const command = requiredString(build.command, `${field}.command`, 80)
  if (!/^[A-Za-z0-9_.-]+$/.test(command)) throw new Error(`${field}.command 只能是命令名，不能包含路径或 shell 片段`)
  if (!Array.isArray(build.args)) throw new Error(`${field}.args 必须是数组`)
  return {
    command,
    args: build.args.map((arg, index) => requiredString(arg, `${field}.args[${index}]`, 240)),
  }
}

function validateCatalogIcon(value, field) {
  const icon = assertPlainObject(value, field)
  assertKnownKeys(icon, field, ['type', 'value', 'url', 'dataUrl'])
  const type = requiredString(icon.type, `${field}.type`, 24)
  if (!CATALOG_ICON_TYPES.has(type)) throw new Error(`${field}.type 必须为 emoji/url/data`)
  if (type === 'emoji') {
    const valueText = requiredString(icon.value, `${field}.value`, 8)
    if (/[\\/.]/.test(valueText)) throw new Error(`${field}.value 不是合法 emoji 文本`)
    return { type, value: valueText }
  }
  if (type === 'url') {
    const url = requiredString(icon.url, `${field}.url`, 2048)
    if (!url.startsWith('https://')) throw new Error(`${field}.url 必须是 https:// URL`)
    return { type, url }
  }
  const dataUrl = requiredString(icon.dataUrl, `${field}.dataUrl`, 200_000)
  if (!dataUrl.startsWith('data:image/')) throw new Error(`${field}.dataUrl 必须是 data:image/ URL`)
  return { type, dataUrl }
}

function validateDisplayMode(value, field) {
  const mode = requiredString(value, field, 24)
  if (!APP_DISPLAY_MODES.has(mode)) throw new Error(`${field} 必须为 default/window/top`)
  return mode
}

function validateCommands(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`)
  const seen = new Set()
  return value.map((command, index) => {
    const item = assertPlainObject(command, `${field}[${index}]`)
    assertKnownKeys(item, `${field}[${index}]`, ['id', 'title'])
    const id = requiredString(item.id, `${field}[${index}].id`, 80)
    const title = requiredString(item.title, `${field}[${index}].title`, 80)
    if (!isSafeId(id)) throw new Error(`${field}[${index}].id 不合法: ${id}`)
    if (seen.has(id)) throw new Error(`${field}[${index}].id 重复: ${id}`)
    seen.add(id)
    return { id, title }
  })
}

function validatePackageFiles(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} 必须是非空数组`)
  const seenTo = new Set()
  return value.map((entry, index) => {
    const item = assertPlainObject(entry, `${field}[${index}]`)
    assertKnownKeys(item, `${field}[${index}]`, ['from', 'to'])
    const from = normalizeRel(requiredString(item.from, `${field}[${index}].from`, 300), `${field}[${index}].from`)
    const to = normalizeRel(requiredString(item.to, `${field}[${index}].to`, 300), `${field}[${index}].to`)
    if (to === 'fw-app.json') throw new Error(`${field}[${index}].to 不能覆盖 fw-app.json`)
    if (seenTo.has(to)) throw new Error(`${field}[${index}].to 重复: ${to}`)
    seenTo.add(to)
    return { from, to }
  })
}

function validatePackageProfile(value, field) {
  const profile = assertPlainObject(value, field)
  assertKnownKeys(profile, field, ['build', 'stageDir', 'files'])
  return {
    buildCommand: validateBuildCommand(profile.build, `${field}.build`),
    stageDir: normalizeRel(requiredString(profile.stageDir, `${field}.stageDir`, 240), `${field}.stageDir`),
    files: validatePackageFiles(profile.files, `${field}.files`),
  }
}

function validatePackageProfiles(value, field) {
  const profiles = assertPlainObject(value, field)
  assertKnownKeys(profiles, field, V5_APP_PROFILE_IDS)
  const out = {}
  for (const profileId of V5_APP_PROFILE_IDS) {
    if (!(profileId in profiles)) throw new Error(`${field}.${profileId} 缺失`)
    out[profileId] = validatePackageProfile(profiles[profileId], `${field}.${profileId}`)
  }
  return out
}

function validateProfileExecutableMappings(profiles, executable) {
  for (const [profileId, profile] of Object.entries(profiles)) {
    const hasExecutable = profile.files.some(file => file.to === executable)
    if (!hasExecutable) throw new Error(`profiles.${profileId}.files 必须包含 package.windowsExecutable 的来源映射: ${executable}`)
  }
}

function normalizePackageManifest(raw, { appDir, expectedId, manifestPath }) {
  const manifest = assertPlainObject(raw, manifestPath)
  assertKnownKeys(manifest, manifestPath, [
    'schemaVersion',
    'id',
    'name',
    'description',
    'versionSource',
    'profiles',
    'package',
    'catalogIcon',
    'displayMode',
    'commands',
  ])
  if (manifest.schemaVersion !== V5_APP_PACKAGE_SCHEMA_VERSION) {
    throw new Error(`${manifestPath}.schemaVersion 必须为 ${V5_APP_PACKAGE_SCHEMA_VERSION}`)
  }

  const id = requiredString(manifest.id, 'id', 80)
  if (!isSafeId(id)) throw new Error(`app id 不合法: ${id}`)
  if (id !== expectedId) throw new Error(`发布声明 id 与 --app 不一致: manifest=${id}, app=${expectedId}`)

  const pkg = assertPlainObject(manifest.package, 'package')
  assertKnownKeys(pkg, 'package', ['windowsExecutable', 'icon'])
  const executable = normalizeRel(requiredString(pkg.windowsExecutable, 'package.windowsExecutable', 240), 'package.windowsExecutable')
  if (!executable.toLowerCase().endsWith('.exe')) throw new Error('package.windowsExecutable 必须指向 .exe')
  const profiles = validatePackageProfiles(manifest.profiles, 'profiles')
  validateProfileExecutableMappings(profiles, executable)

  return {
    appDir,
    manifestPath,
    id,
    name: requiredString(manifest.name, 'name', 120),
    description: requiredString(manifest.description, 'description', 500),
    versionSource: normalizeRel(requiredString(manifest.versionSource, 'versionSource', 240), 'versionSource'),
    profiles,
    executable,
    icon: normalizeRel(requiredString(pkg.icon, 'package.icon', 240), 'package.icon'),
    catalogIcon: validateCatalogIcon(manifest.catalogIcon, 'catalogIcon'),
    displayMode: validateDisplayMode(manifest.displayMode, 'displayMode'),
    commands: validateCommands(manifest.commands, 'commands'),
  }
}

export async function loadV5AppPackageConfig(appId) {
  const id = String(appId || '').trim()
  if (!isSafeId(id)) throw new Error(`app id 不合法: ${id}`)
  const appDir = path.join(rootDir, 'apps', id)
  const manifestPath = path.join(appDir, V5_APP_PACKAGE_MANIFEST_FILE)
  let manifest = null
  try {
    manifest = await readJson(manifestPath)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`缺少 v5 app 发布声明: ${manifestPath}`)
    throw error
  }
  return normalizePackageManifest(manifest, { appDir, expectedId: id, manifestPath })
}
