import fs from 'node:fs/promises'
import path from 'node:path'
import { compareSemverStrict, parseSemverStrict, readJson, rootDir } from './v5-app-packaging.mjs'

const HOST_VERSION_FILES = [
  'package.json',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.lock',
]

export function defaultHostVersionDeclaration() {
  return { kind: '' }
}

export function consumeHostVersionArg(declaration, args, index) {
  const arg = args[index]
  if (arg === '--keep-version') {
    setHostVersionDeclaration(declaration, { kind: 'keep' })
    return index
  }
  if (arg === '--bump') {
    const bump = String(args[index + 1] || '').trim()
    if (!bump) throw new Error('--bump 需要指定 patch、minor 或 major')
    setHostVersionDeclaration(declaration, { kind: 'bump', bump: normalizeBump(bump) })
    return index + 1
  }
  if (arg === '--version') {
    const version = String(args[index + 1] || '').trim()
    if (!version) throw new Error('--version 需要指定 x.y.z 版本号')
    setHostVersionDeclaration(declaration, { kind: 'version', version: normalizeSemver(version, '--version') })
    return index + 1
  }
  return -1
}

export function hostVersionUsageLines({ allowKeep = true } = {}) {
  return [
    'Version declaration (required):',
    ...(allowKeep ? ['  --keep-version           use the current host version without changing files'] : []),
    '  --bump patch|minor|major bump host version explicitly',
    '  --version x.y.z         set an explicit new host version',
  ]
}

export async function resolveHostVersionPlan(declaration, opts = {}) {
  const normalized = normalizeDeclaration(declaration, opts)
  const state = await loadHostVersionState()
  const targetVersion = resolveTargetVersion(state.currentVersion, normalized)
  if (normalized.kind !== 'keep') {
    const cmp = compareSemverStrict(targetVersion, state.currentVersion)
    if (cmp <= 0) {
      throw new Error(`宿主新版本必须高于当前版本：当前=${state.currentVersion}，目标=${targetVersion}。如果要复用当前版本，请显式使用 --keep-version。`)
    }
  }
  return {
    declaration: normalized,
    currentVersion: state.currentVersion,
    targetVersion,
    changesVersion: targetVersion !== state.currentVersion,
    packageName: state.packageName,
    paths: state.paths,
  }
}

export async function applyHostVersionPlan(plan, opts = {}) {
  const dryRun = opts.dryRun === true
  if (!plan.changesVersion) {
    return { ...publicHostVersionPlan(plan), dryRun, changedFiles: [] }
  }

  const updates = await buildHostVersionUpdates(plan)
  const changedFiles = []
  for (const update of updates) {
    const before = await fs.readFile(update.filePath, 'utf8')
    const after = preserveNewline(before, update.update(before))
    if (after !== before) {
      changedFiles.push(update.label)
      if (!dryRun) await fs.writeFile(update.filePath, after, 'utf8')
    }
  }
  return { ...publicHostVersionPlan(plan), dryRun, changedFiles }
}

export function publicHostVersionPlan(plan) {
  return {
    declaration: formatDeclaration(plan.declaration),
    currentVersion: plan.currentVersion,
    targetVersion: plan.targetVersion,
    changesVersion: plan.changesVersion,
    files: HOST_VERSION_FILES,
  }
}

function setHostVersionDeclaration(target, next) {
  if (target.kind) {
    throw new Error('宿主版本策略只能声明一个：--keep-version、--bump、--version 三选一')
  }
  Object.assign(target, next)
}

function normalizeDeclaration(declaration, opts) {
  const allowKeep = opts.allowKeep !== false
  const commandName = String(opts.commandName || 'host command')
  const kind = String(declaration?.kind || '').trim()
  if (!kind) {
    const choices = allowKeep ? '--keep-version、--bump patch|minor|major 或 --version x.y.z' : '--bump patch|minor|major 或 --version x.y.z'
    throw new Error(`${commandName} 必须显式声明宿主版本策略：${choices}`)
  }
  if (kind === 'keep') {
    if (!allowKeep) throw new Error(`${commandName} 不允许 --keep-version；请使用 --bump 或 --version`)
    return { kind }
  }
  if (kind === 'bump') return { kind, bump: normalizeBump(declaration.bump) }
  if (kind === 'version') return { kind, version: normalizeSemver(declaration.version, '--version') }
  throw new Error(`未知宿主版本策略: ${kind}`)
}

function normalizeBump(raw) {
  const bump = String(raw || '').trim()
  if (bump === 'patch' || bump === 'minor' || bump === 'major') return bump
  throw new Error(`--bump 只允许 patch、minor 或 major: ${bump || '(empty)'}`)
}

function normalizeSemver(raw, field) {
  const version = String(raw || '').trim()
  if (!parseSemverStrict(version)) throw new Error(`${field} 必须是 x.y.z 格式: ${version || '(empty)'}`)
  return version
}

function resolveTargetVersion(currentVersion, declaration) {
  if (declaration.kind === 'keep') return currentVersion
  if (declaration.kind === 'version') return declaration.version
  const [major, minor, patch] = currentVersion.split('.').map(Number)
  if (declaration.bump === 'patch') return `${major}.${minor}.${patch + 1}`
  if (declaration.bump === 'minor') return `${major}.${minor + 1}.0`
  if (declaration.bump === 'major') return `${major + 1}.0.0`
  throw new Error(`未知 bump 类型: ${declaration.bump}`)
}

function formatDeclaration(declaration) {
  if (declaration.kind === 'keep') return '--keep-version'
  if (declaration.kind === 'bump') return `--bump ${declaration.bump}`
  if (declaration.kind === 'version') return `--version ${declaration.version}`
  return '(unknown)'
}

async function loadHostVersionState() {
  const packageJsonPath = path.join(rootDir, 'package.json')
  const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml')
  const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock')
  const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json')

  const [pkg, cargoTomlText, cargoLockText, tauriConf] = await Promise.all([
    readJson(packageJsonPath),
    fs.readFile(cargoTomlPath, 'utf8'),
    fs.readFile(cargoLockPath, 'utf8'),
    readJson(tauriConfPath),
  ])

  const currentVersion = normalizeSemver(pkg.version, 'package.json.version')
  const packageName = readCargoPackageName(cargoTomlText) || String(pkg.name || '').trim()
  if (!packageName) throw new Error('无法确定宿主 Cargo package name')

  const versions = [
    ['package.json', currentVersion],
    ['src-tauri/Cargo.toml', normalizeSemver(readCargoPackageVersion(cargoTomlText), 'src-tauri/Cargo.toml version')],
    ['src-tauri/tauri.conf.json', normalizeSemver(tauriConf.version, 'src-tauri/tauri.conf.json version')],
    ['src-tauri/Cargo.lock', normalizeSemver(readCargoLockPackageVersion(cargoLockText, packageName), 'src-tauri/Cargo.lock version')],
  ]
  const mismatched = versions.filter(([, version]) => version !== currentVersion)
  if (mismatched.length) {
    throw new Error(`宿主版本文件不一致：${versions.map(([label, version]) => `${label}=${version}`).join('，')}`)
  }

  return {
    currentVersion,
    packageName,
    paths: { packageJsonPath, cargoTomlPath, cargoLockPath, tauriConfPath },
  }
}

async function buildHostVersionUpdates(plan) {
  return [
    {
      label: 'package.json',
      filePath: plan.paths.packageJsonPath,
      update: text => updateJsonTopLevelVersion(text, plan.targetVersion, 'package.json'),
    },
    {
      label: 'src-tauri/Cargo.toml',
      filePath: plan.paths.cargoTomlPath,
      update: text => updateCargoTomlPackageVersion(text, plan.targetVersion),
    },
    {
      label: 'src-tauri/tauri.conf.json',
      filePath: plan.paths.tauriConfPath,
      update: text => updateJsonTopLevelVersion(text, plan.targetVersion, 'src-tauri/tauri.conf.json'),
    },
    {
      label: 'src-tauri/Cargo.lock',
      filePath: plan.paths.cargoLockPath,
      update: text => updateCargoLockPackageVersion(text, plan.packageName, plan.targetVersion),
    },
  ]
}

function preserveNewline(text, updatedText) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const normalized = updatedText.replace(/\r\n?/g, '\n')
  return normalized.replace(/\n/g, newline)
}

function updateJsonTopLevelVersion(text, newVersion, fileLabel) {
  const updated = text.replace(/"version"(\s*:\s*)"[^"]*"/, `"version"$1"${newVersion}"`)
  if (updated === text) throw new Error(`${fileLabel}: cannot find "version" field`)
  return updated
}

function readCargoPackageName(cargoTomlText) {
  return readCargoPackageField(cargoTomlText, 'name')
}

function readCargoPackageVersion(cargoTomlText) {
  return readCargoPackageField(cargoTomlText, 'version')
}

function readCargoPackageField(cargoTomlText, fieldName) {
  const lines = cargoTomlText.split(/\r?\n/)
  const packageIndex = lines.findIndex(line => line.trim() === '[package]')
  if (packageIndex === -1) return ''
  for (let i = packageIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('[')) break
    const match = new RegExp(`^\\s*${fieldName}\\s*=\\s*"([^"]+)"\\s*$`).exec(line)
    if (match) return match[1]
  }
  return ''
}

function updateCargoTomlPackageVersion(text, newVersion) {
  const lines = text.split(/\r?\n/)
  const packageIndex = lines.findIndex(line => line.trim() === '[package]')
  if (packageIndex === -1) throw new Error('Cargo.toml: cannot find [package] section')
  for (let i = packageIndex + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('[')) break
    if (lines[i].trim().startsWith('version =')) {
      lines[i] = lines[i].replace(/(version\s*=\s*)".*?"/, `$1"${newVersion}"`)
      return lines.join('\n')
    }
  }
  throw new Error('Cargo.toml: cannot find package version line')
}

function readCargoLockPackageVersion(text, packageName) {
  const lines = text.split(/\r?\n/)
  const nameIndex = lines.findIndex(line => line.trim() === `name = "${packageName}"`)
  if (nameIndex === -1) return ''
  for (let i = nameIndex + 1; i < Math.min(nameIndex + 30, lines.length); i++) {
    if (lines[i].trim().startsWith('name = "')) break
    const match = /^\s*version\s*=\s*"([^"]+)"\s*$/.exec(lines[i])
    if (match) return match[1]
  }
  return ''
}

function updateCargoLockPackageVersion(text, packageName, newVersion) {
  const lines = text.split(/\r?\n/)
  const nameIndex = lines.findIndex(line => line.trim() === `name = "${packageName}"`)
  if (nameIndex === -1) throw new Error(`Cargo.lock: cannot find package name: ${packageName}`)
  for (let i = nameIndex + 1; i < Math.min(nameIndex + 30, lines.length); i++) {
    if (lines[i].trim().startsWith('name = "')) break
    if (lines[i].trim().startsWith('version = "')) {
      lines[i] = lines[i].replace(/(version\s*=\s*)".*?"/, `$1"${newVersion}"`)
      return lines.join('\n')
    }
  }
  throw new Error(`Cargo.lock: cannot find version for package: ${packageName}`)
}
