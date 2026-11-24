import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  appRegistryFileName,
  inspectRegisteredApps,
  registerApp,
  resolveRegisteredApp,
} from './modules/fast-window-dev-app-registry.mjs'
import { parseArgs, releaseMode } from './modules/fast-window-dev-cli-args.mjs'
import { checkDependencyParity } from './modules/fast-window-dev-dependency-parity.mjs'
import { dispatchAppAction } from './modules/fast-window-dev-dispatch.mjs'
import { publishArtifactToStore } from './modules/fast-window-dev-release.mjs'
import { checkAppTemplates } from './modules/fast-window-dev-template-check.mjs'
import { unpublishAppFromStore } from './modules/fast-window-dev-unpublish.mjs'
import { verifyAppArtifact } from './modules/fast-window-dev-verify.mjs'

// 中央协议目录：调度工具所在目录；若位于 eucli-code-factory 开发空间内，
// 本机应用注册表与发布凭据自动读写空间 shared/，避免污染源码工作树。
const toolDir = path.dirname(fileURLToPath(import.meta.url))

function findDevSpaceSharedDir(startDir) {
  let cur = path.resolve(startDir)
  while (true) {
    if (existsSync(path.join(cur, '.eucli-dev-space'))) {
      return path.join(cur, 'shared')
    }
    const parent = path.dirname(cur)
    if (parent === cur) return ''
    cur = parent
  }
}

const devSpaceSharedDir = findDevSpaceSharedDir(toolDir)
const registryFile = devSpaceSharedDir
  ? path.join(devSpaceSharedDir, appRegistryFileName)
  : path.join(toolDir, appRegistryFileName)
const credentialsDir = devSpaceSharedDir
  ? path.join(devSpaceSharedDir, 'credentials')
  : toolDir
const templateToolFile = path.join(toolDir, 'app-template', 'fast-window-dev-tool.mjs')
const logPrefix = 'fast-window-dev-tool:'

function runRegister({ appName, appDir }) {
  const result = registerApp(registryFile, appName, appDir)
  if (result.previousDir === '') {
    console.log(`${logPrefix} 已登记 ${appName} → ${result.appDir}`)
  } else {
    console.log(`${logPrefix} 已更新登记 ${appName}：${result.previousDir} → ${result.appDir}`)
  }
}

function printReport(title, rows) {
  console.log(`${logPrefix} ${title}（注册表 ${registryFile}）`)
  if (rows.length === 0) console.log('  （空）')
  for (const row of rows) console.log(`  ${row}`)
}

function runList() {
  const apps = inspectRegisteredApps(registryFile)
  printReport(`已登记应用 ${apps.length} 个`, apps.map(app =>
    app.ok ? `[可用]   ${app.appName}  ${app.appDir}` : `[不可用] ${app.appName}  ${app.error}`,
  ))
  const broken = apps.filter(app => !app.ok).length
  if (broken > 0) throw new Error(`${broken} 个登记不可用`)
}

const templateStatusLabel = { 'up-to-date': '[一致]  ', outdated: '[过期]  ', unavailable: '[不可用]' }

function runCheckTemplates() {
  const results = checkAppTemplates(inspectRegisteredApps(registryFile), templateToolFile)
  printReport(`应用工具与中央模板比对 ${results.length} 个`, results.map(item =>
    `${templateStatusLabel[item.status]} ${item.appName}  ${item.detail}`,
  ))
  const failing = results.filter(item => item.status !== 'up-to-date').length
  if (failing > 0) throw new Error(`${failing} 个应用工具未与中央模板保持一致`)
}

const dependencyStatusLabel = { ok: '[一致]  ', loose: '[警告]  ', skipped: '[跳过]  ', unavailable: '[不可用]' }

function describeDrift(entry) {
  return `${entry.packageName} 已装 ${entry.installedVersion} ↔ Rust ${entry.crateName} ${entry.crateVersion}，建议 ${entry.suggestedRange}`
}

function describeLoose(entry) {
  return `${entry.packageName} 区间 ${entry.declaredRange} 允许漂到别的次版本，建议 ${entry.suggestedRange}`
}

function runCheckDeps() {
  const results = checkDependencyParity(inspectRegisteredApps(registryFile))
  printReport(`依赖版本一致性 ${results.length} 个`, results.map(app => {
    if (app.status === 'failing') {
      return `[失败]   ${app.appName}  ${app.entries.filter(entry => entry.status === 'drift').map(describeDrift).join('；')}`
    }
    if (app.status === 'loose') {
      return `[警告]   ${app.appName}  ${app.entries.filter(entry => entry.status === 'loose').map(describeLoose).join('；')}`
    }
    const detail = app.detail === '' ? app.entries.map(entry => `${entry.packageName} ${entry.installedVersion || '未安装'} ↔ ${entry.crateVersion}`).join('；') : app.detail
    return `${dependencyStatusLabel[app.status]} ${app.appName}  ${detail}`
  }))
  const failing = results.filter(app => app.status === 'failing').length
  if (failing > 0) throw new Error(`${failing} 个应用的前端包与 Rust crate 次版本不一致，构建会被 Tauri 拒绝`)
}

async function runVerify({ appName, zip, catalog }) {
  const { protocolDir } = resolveRegisteredApp(registryFile, appName)
  const result = await verifyAppArtifact({ protocolDir, artifactPath: zip, catalogPath: catalog })
  console.log(JSON.stringify(result))
  console.log(`${logPrefix} ${appName} 校验通过（v${result.version}，sha256 ${result.artifact.sha256}）`)
}

async function runUnpublish({ appName, dryRun }) {
  const { protocolDir } = resolveRegisteredApp(registryFile, appName)
  const result = await unpublishAppFromStore({ protocolDir, credentialsDir, dryRun })
  console.log(JSON.stringify(result))
  console.log(`${logPrefix} ${appName} 下架${result.dryRun ? '预演' : ''}完成（移除 ${result.removed.id} v${result.removed.version}）`)
}

async function runAction({ appName, action, mode }) {
  const { protocolDir, toolFile } = resolveRegisteredApp(registryFile, appName)
  const receipt = await dispatchAppAction({ protocolDir, toolFile, action })
  console.log(`${logPrefix} ${appName} ${action} 执行成功`)
  const artifactPath = typeof receipt.data?.artifact?.path === 'string' ? receipt.data.artifact.path : ''
  if (artifactPath !== '') console.log(`${logPrefix} 成品 ${artifactPath}`)
  if (mode !== releaseMode) return
  if (artifactPath === '') throw new Error(`动作 ${action} 没有可发布的成品`)
  const published = await publishArtifactToStore({ protocolDir, credentialsDir, artifactPath })
  console.log(`${logPrefix} 已发布 ${published.appId} ${published.version}`)
  console.log(`${logPrefix} 发布地址 ${published.releaseUrl}`)
  console.log(`${logPrefix} 商店目录 ${published.catalogUrl}`)
}

const runners = {
  register: runRegister,
  list: runList,
  'check-templates': runCheckTemplates,
  'check-deps': runCheckDeps,
  verify: runVerify,
  unpublish: runUnpublish,
  action: runAction,
}

async function main() {
  const command = parseArgs(process.argv)
  await runners[command.kind](command)
}

await main().catch(error => {
  console.error(String(error?.message || error))
  process.exitCode = 1
})
