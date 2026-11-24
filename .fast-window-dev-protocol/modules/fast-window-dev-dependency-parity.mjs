// 依赖版本一致性：应用的 @tauri-apps/* 前端包必须与 Cargo.lock 里对应 Rust crate 同一次版本。
// Tauri 在构建前会做同样的比对，不一致直接拒绝构建；这里把发现提前到构型检查阶段。
// 只检查不修改：区间怎么收窄、依赖何时重装由应用自己决定。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const npmScope = '@tauri-apps/'
const cargoLockRelativePath = path.join('src-tauri', 'Cargo.lock')

// @tauri-apps/api → tauri；@tauri-apps/plugin-x → tauri-plugin-x；
// @tauri-apps/cli 是构建工具，按 Tauri 官方约定与核心 crate 保持同一次版本。
export function crateNameForNpmPackage(packageName) {
  const suffix = packageName.slice(npmScope.length)
  return suffix === 'api' || suffix === 'cli' ? 'tauri' : `tauri-${suffix}`
}

export function minorOf(version) {
  const parts = String(version).split('.')
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : ''
}

// Cargo.lock 是 [[package]] 段落堆叠，同一 crate 可能有多个版本并存；
// 取第一个出现的即可：应用直接依赖的总是最外层声明的那份。
export function readCrateVersions(cargoLockFile) {
  const versions = new Map()
  for (const block of readFileSync(cargoLockFile, 'utf8').split('[[package]]')) {
    const name = block.match(/^\s*name = "([^"]+)"/m)
    const version = block.match(/^\s*version = "([^"]+)"/m)
    if (name && version && !versions.has(name[1])) versions.set(name[1], version[1])
  }
  return versions
}

// 声明的版本区间是否被锁在本次版本之内：~ 与精确版本不会跨次版本，^ 与通配会。
export function rangeCrossesMinor(range) {
  const text = String(range ?? '').trim()
  if (text.startsWith('~')) return false
  if (/^\d+\.\d+\.\d+$/.test(text)) return false
  return true
}

function suggestedRangeOf(crateVersion) {
  const [major, minor] = String(crateVersion).split('.')
  return `~${major}.${minor}.0`
}

function readInstalledVersion(appDir, packageName) {
  const manifest = path.join(appDir, 'node_modules', ...packageName.split('/'), 'package.json')
  if (!existsSync(manifest)) return ''
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? ''
  } catch {
    return ''
  }
}

// 单应用体检：返回不适用（不是 Node 应用 / 不依赖 Tauri）或逐条比对结果。
export function inspectDependencyParity(appDir) {
  const packageFile = path.join(appDir, 'package.json')
  const cargoLockFile = path.join(appDir, cargoLockRelativePath)
  if (!existsSync(packageFile) || !existsSync(cargoLockFile)) return { applicable: false, entries: [] }

  const manifest = JSON.parse(readFileSync(packageFile, 'utf8'))
  const declared = { ...manifest.dependencies, ...manifest.devDependencies }
  const packages = Object.keys(declared).filter(name => name.startsWith(npmScope))
  if (packages.length === 0) return { applicable: false, entries: [] }

  const crates = readCrateVersions(cargoLockFile)
  const entries = packages.sort().map(packageName => {
    const crateName = crateNameForNpmPackage(packageName)
    const crateVersion = crates.get(crateName) ?? ''
    const declaredRange = String(declared[packageName])
    const installedVersion = readInstalledVersion(appDir, packageName)
    const base = { packageName, crateName, crateVersion, declaredRange, installedVersion }
    if (crateVersion === '') return { ...base, status: 'unbound' }
    const crateMinor = minorOf(crateVersion)
    const suggestedRange = suggestedRangeOf(crateVersion)
    if (installedVersion !== '' && minorOf(installedVersion) !== crateMinor) {
      return { ...base, status: 'drift', suggestedRange }
    }
    return { ...base, status: rangeCrossesMinor(declaredRange) ? 'loose' : 'ok', suggestedRange }
  })
  return { applicable: true, entries }
}

// 全量体检：逐应用判定，不因单条失败中断，由调用方决定呈现与退出码。
export function checkDependencyParity(inspectedApps) {
  return inspectedApps.map(app => {
    if (!app.ok) return { appName: app.appName, appDir: app.appDir, status: 'unavailable', detail: app.error, entries: [] }
    const report = inspectDependencyParity(app.appDir)
    if (!report.applicable) return { appName: app.appName, appDir: app.appDir, status: 'skipped', detail: '不依赖 Tauri 前端包', entries: [] }
    const failing = report.entries.find(entry => entry.status === 'drift')
    const loose = report.entries.find(entry => entry.status === 'loose')
    const status = failing ? 'failing' : loose ? 'loose' : 'ok'
    return { appName: app.appName, appDir: app.appDir, status, detail: '', entries: report.entries }
  })
}
