import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const rootDir = path.resolve(__dirname, '..', '..')

const SAFE_APP_ID_RE = /^[A-Za-z0-9_-]+$/
const STRICT_SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/

function relLabel(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replaceAll('\\', '/')
}

function fail(message) {
  throw new Error(message)
}

export function isSafeV5AppId(appId) {
  return SAFE_APP_ID_RE.test(String(appId || '').trim())
}

export function normalizeV5AppId(appId) {
  const id = String(appId || '').trim()
  if (!isSafeV5AppId(id)) fail(`v5 app id 不合法: ${id || '(empty)'}`)
  return id
}

export function parseSemverStrict(raw) {
  const text = String(raw || '').trim()
  const match = STRICT_SEMVER_RE.exec(text)
  if (!match) return null
  return {
    text,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function assertSemverStrict(raw, field) {
  const version = parseSemverStrict(raw)
  if (!version) fail(`${field} 必须是 x.y.z 格式: ${raw}`)
  return version
}

export function bumpSemverStrict(version, bump) {
  const v = assertSemverStrict(version, 'version')
  if (bump === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`
  if (bump === 'minor') return `${v.major}.${v.minor + 1}.0`
  if (bump === 'major') return `${v.major + 1}.0.0`
  fail(`未知升版类型: ${bump}`)
}

export function inferV5AppIdFromCwd(cwd = process.cwd(), repoRoot = rootDir) {
  const appsDir = path.join(repoRoot, 'apps')
  const rel = path.relative(appsDir, cwd)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return ''
  const [id] = rel.split(/[\\/]/)
  return isSafeV5AppId(id) ? id : ''
}

function preserveNewline(text, updatedText) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  return updatedText.replace(/\r\n?/g, '\n').replace(/\n/g, newline)
}

async function readRequiredText(filePath, label) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`缺少 v5 app 版本目标: ${label}`)
    throw error
  }
}

async function assertRequiredDir(dirPath, label) {
  let stat
  try {
    stat = await fs.stat(dirPath)
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`缺少 v5 app 目录: ${label}`)
    throw error
  }
  if (!stat.isDirectory()) fail(`v5 app 路径不是目录: ${label}`)
}

function jsonVersionLineMatches(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .map(({ line, index }) => ({
      index,
      match: /^\s*"version"\s*:\s*"([^"]*)"\s*,?\s*$/.exec(line),
    }))
    .filter(item => item.match)
}

function readJsonVersion(text, label) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    fail(`${label}: JSON 解析失败: ${error?.message || error}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${label}: 顶层必须是 JSON 对象`)
  if (typeof parsed.version !== 'string') fail(`${label}: 顶层 version 必须存在且是字符串`)
  const parsedVersion = assertSemverStrict(parsed.version, `${label}.version`).text

  const matches = jsonVersionLineMatches(text)
  if (matches.length !== 1) fail(`${label}: version 行必须唯一，当前找到 ${matches.length} 个`)
  const lineVersion = assertSemverStrict(matches[0].match[1], `${label}.version`).text
  if (lineVersion !== parsedVersion) fail(`${label}: version 行与 JSON 顶层 version 不一致`)
  return parsedVersion
}

function updateJsonVersion(text, newVersion, label) {
  readJsonVersion(text, label)
  const matches = jsonVersionLineMatches(text)
  if (matches.length !== 1) fail(`${label}: version 行必须唯一，当前找到 ${matches.length} 个`)

  const lines = text.split(/\r?\n/)
  const index = matches[0].index
  lines[index] = lines[index].replace(/("version"\s*:\s*)"[^"]*"/, `$1"${newVersion}"`)
  const updated = lines.join('\n')
  const updatedVersion = readJsonVersion(updated, label)
  if (updatedVersion !== newVersion) fail(`${label}: 更新后 version 校验失败`)
  return preserveNewline(text, updated)
}

function findCargoPackageSection(lines, label) {
  const packageIndex = lines.findIndex(line => line.trim() === '[package]')
  if (packageIndex === -1) fail(`${label}: 缺少 [package] 段`)
  let endIndex = lines.length
  for (let i = packageIndex + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('[')) {
      endIndex = i
      break
    }
  }
  return { packageIndex, endIndex }
}

function readCargoPackage(text, label) {
  const lines = text.split(/\r?\n/)
  const { packageIndex, endIndex } = findCargoPackageSection(lines, label)
  let name = ''
  let version = ''
  for (let i = packageIndex + 1; i < endIndex; i++) {
    const nameMatch = /^\s*name\s*=\s*"([^"]+)"\s*$/.exec(lines[i])
    if (nameMatch) name = nameMatch[1]
    const versionMatch = /^\s*version\s*=\s*"([^"]+)"\s*$/.exec(lines[i])
    if (versionMatch) version = versionMatch[1]
  }
  if (!name) fail(`${label}: [package] 缺少 name`)
  if (!version) fail(`${label}: [package] 缺少 version`)
  return { name, version: assertSemverStrict(version, `${label}.version`).text }
}

function updateCargoPackageVersion(text, newVersion, label) {
  const lines = text.split(/\r?\n/)
  const { packageIndex, endIndex } = findCargoPackageSection(lines, label)
  let versionIndex = -1
  for (let i = packageIndex + 1; i < endIndex; i++) {
    if (/^\s*version\s*=\s*"[^"]+"\s*$/.test(lines[i])) {
      versionIndex = i
      break
    }
  }
  if (versionIndex === -1) fail(`${label}: [package] 缺少 version`)
  lines[versionIndex] = lines[versionIndex].replace(/(version\s*=\s*)"[^"]+"/, `$1"${newVersion}"`)
  const updated = lines.join('\n')
  if (readCargoPackage(updated, label).version !== newVersion) fail(`${label}: 更新后 version 校验失败`)
  return preserveNewline(text, updated)
}

function cargoLockSections(lines) {
  const starts = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '[[package]]') starts.push(i)
  }
  return starts.map((start, index) => ({
    start,
    end: index + 1 < starts.length ? starts[index + 1] : lines.length,
  }))
}

function readCargoLockPackageVersion(text, packageName, label) {
  const lines = text.split(/\r?\n/)
  const matches = []
  for (const section of cargoLockSections(lines)) {
    let name = ''
    let version = ''
    let versionIndex = -1
    for (let i = section.start + 1; i < section.end; i++) {
      const nameMatch = /^\s*name\s*=\s*"([^"]+)"\s*$/.exec(lines[i])
      if (nameMatch) name = nameMatch[1]
      const versionMatch = /^\s*version\s*=\s*"([^"]+)"\s*$/.exec(lines[i])
      if (versionMatch) {
        version = versionMatch[1]
        versionIndex = i
      }
    }
    if (name === packageName) matches.push({ version, versionIndex })
  }
  if (matches.length !== 1) fail(`${label}: 必须唯一包含 Cargo package ${packageName}，当前找到 ${matches.length} 个`)
  if (matches[0].versionIndex === -1) fail(`${label}: package ${packageName} 缺少 version`)
  return assertSemverStrict(matches[0].version, `${label}.${packageName}.version`).text
}

function updateCargoLockPackageVersion(text, packageName, newVersion, label) {
  const lines = text.split(/\r?\n/)
  let matchedVersionIndex = -1
  let matchedCount = 0
  for (const section of cargoLockSections(lines)) {
    let name = ''
    let versionIndex = -1
    for (let i = section.start + 1; i < section.end; i++) {
      const nameMatch = /^\s*name\s*=\s*"([^"]+)"\s*$/.exec(lines[i])
      if (nameMatch) name = nameMatch[1]
      if (/^\s*version\s*=\s*"[^"]+"\s*$/.test(lines[i])) versionIndex = i
    }
    if (name === packageName) {
      matchedCount++
      matchedVersionIndex = versionIndex
    }
  }
  if (matchedCount !== 1) fail(`${label}: 必须唯一包含 Cargo package ${packageName}，当前找到 ${matchedCount} 个`)
  if (matchedVersionIndex === -1) fail(`${label}: package ${packageName} 缺少 version`)
  lines[matchedVersionIndex] = lines[matchedVersionIndex].replace(/(version\s*=\s*)"[^"]+"/, `$1"${newVersion}"`)
  const updated = lines.join('\n')
  if (readCargoLockPackageVersion(updated, packageName, label) !== newVersion) fail(`${label}: 更新后 version 校验失败`)
  return preserveNewline(text, updated)
}

function makeJsonTarget(repoRoot, filePath) {
  const label = relLabel(repoRoot, filePath)
  return {
    label,
    filePath,
    readVersion: text => readJsonVersion(text, label),
    updateText: (text, newVersion) => updateJsonVersion(text, newVersion, label),
  }
}

function makeCargoTomlTarget(repoRoot, filePath) {
  const label = relLabel(repoRoot, filePath)
  return {
    label,
    filePath,
    readVersion: text => readCargoPackage(text, label).version,
    updateText: (text, newVersion) => updateCargoPackageVersion(text, newVersion, label),
  }
}

function makeCargoLockTarget(repoRoot, filePath, packageName) {
  const label = relLabel(repoRoot, filePath)
  return {
    label,
    filePath,
    readVersion: text => readCargoLockPackageVersion(text, packageName, label),
    updateText: (text, newVersion) => updateCargoLockPackageVersion(text, packageName, newVersion, label),
  }
}

export async function createV5AppVersionPlan(appId, repoRootArg = rootDir) {
  const id = normalizeV5AppId(appId)
  const repoRoot = path.resolve(repoRootArg)
  const appDir = path.join(repoRoot, 'apps', id)
  await assertRequiredDir(appDir, relLabel(repoRoot, appDir))

  const packageJsonPath = path.join(appDir, 'package.json')
  const tauriConfPath = path.join(appDir, 'src-tauri', 'tauri.conf.json')
  const tauriDevConfPath = path.join(appDir, 'src-tauri', 'tauri.conf.dev.json')
  const cargoTomlPath = path.join(appDir, 'src-tauri', 'Cargo.toml')
  const cargoLockPath = path.join(appDir, 'src-tauri', 'Cargo.lock')

  const cargoLabel = relLabel(repoRoot, cargoTomlPath)
  const cargoTomlText = await readRequiredText(cargoTomlPath, cargoLabel)
  const cargoPackage = readCargoPackage(cargoTomlText, cargoLabel)

  return {
    appId: id,
    appDir,
    repoRoot,
    cargoPackageName: cargoPackage.name,
    targets: [
      makeJsonTarget(repoRoot, packageJsonPath),
      makeJsonTarget(repoRoot, tauriConfPath),
      makeJsonTarget(repoRoot, tauriDevConfPath),
      makeCargoTomlTarget(repoRoot, cargoTomlPath),
      makeCargoLockTarget(repoRoot, cargoLockPath, cargoPackage.name),
    ],
  }
}

export async function readV5AppVersionState(appId, { repoRoot: repoRootArg = rootDir } = {}) {
  const plan = await createV5AppVersionPlan(appId, repoRootArg)
  const entries = []
  for (const target of plan.targets) {
    const text = await readRequiredText(target.filePath, target.label)
    entries.push({
      ...target,
      text,
      version: target.readVersion(text),
    })
  }
  return { ...plan, entries }
}

export function assertUnifiedV5AppVersion(entries, appId) {
  const versions = new Map()
  for (const entry of entries) {
    if (!versions.has(entry.version)) versions.set(entry.version, [])
    versions.get(entry.version).push(entry.label)
  }
  if (versions.size === 1) return entries[0].version

  const details = Array.from(versions.entries())
    .map(([version, labels]) => `  ${version}: ${labels.join(', ')}`)
    .join('\n')
  fail(`v5 app ${appId} 版本漂移，拒绝升版:\n${details}`)
}

export async function checkV5AppVersion(appId, opts = {}) {
  const state = await readV5AppVersionState(appId, opts)
  const currentVersion = assertUnifiedV5AppVersion(state.entries, state.appId)
  return {
    appId: state.appId,
    currentVersion,
    cargoPackageName: state.cargoPackageName,
    files: state.entries.map(entry => ({ label: entry.label, version: entry.version })),
  }
}

export async function bumpV5AppVersion({ appId, bump = 'patch', to = null, dryRun = false, repoRoot: repoRootArg = rootDir }) {
  const state = await readV5AppVersionState(appId, { repoRoot: repoRootArg })
  const oldVersion = assertUnifiedV5AppVersion(state.entries, state.appId)
  const newVersion = to ? assertSemverStrict(to, '--to').text : bumpSemverStrict(oldVersion, bump)
  if (newVersion === oldVersion) fail('新版本等于当前版本，拒绝无意义升版')

  const changed = []
  for (const entry of state.entries) {
    const updated = entry.updateText(entry.text, newVersion)
    if (updated === entry.text) fail(`${entry.label}: 版本写入没有产生变化`)
    if (entry.readVersion(updated) !== newVersion) fail(`${entry.label}: 写入后版本校验失败`)
    changed.push({ label: entry.label, filePath: entry.filePath })
    if (!dryRun) await fs.writeFile(entry.filePath, updated, 'utf8')
  }

  if (!dryRun) {
    const verified = await checkV5AppVersion(state.appId, { repoRoot: state.repoRoot })
    if (verified.currentVersion !== newVersion) fail(`二次校验失败: expected=${newVersion}, got=${verified.currentVersion}`)
  }

  return {
    appId: state.appId,
    oldVersion,
    newVersion,
    dryRun,
    cargoPackageName: state.cargoPackageName,
    files: changed.map(item => item.label),
  }
}
