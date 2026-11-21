// 应用注册表：应用名 → 应用根目录绝对路径，是中央调度寻址应用的唯一来源。
// 注册表记录的是本机路径，不进版本库；任何登记不实（路径不存在、未接入协议）都直接报错。

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const appRegistryFileName = 'app-registry.json'
export const appProtocolDirName = '.fast-window-dev-protocol'
export const appProtocolFileName = 'fast-window-dev-protocol.json'
export const appToolFilePrefix = 'fast-window-dev-tool.'

// 应用名会出现在命令行与路径语境里，只允许单段名。
export function isSafeAppName(value) {
  return typeof value === 'string' && value !== '' && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

export function readAppRegistry(registryFile) {
  if (!existsSync(registryFile)) return {}
  let parsed
  try {
    parsed = JSON.parse(readFileSync(registryFile, 'utf8'))
  } catch (error) {
    throw new Error(`应用注册表解析失败：${registryFile}（${error.message}）`)
  }
  const apps = parsed?.apps
  if (!apps || typeof apps !== 'object' || Array.isArray(apps)) {
    throw new Error(`应用注册表缺少 apps 对象：${registryFile}`)
  }
  for (const [appName, appDir] of Object.entries(apps)) {
    if (!isSafeAppName(appName)) throw new Error(`应用注册表含非法应用名：${appName}`)
    if (typeof appDir !== 'string' || !path.isAbsolute(appDir)) {
      throw new Error(`应用注册表中 ${appName} 的路径必须是绝对路径：${appDir}`)
    }
  }
  return { ...apps }
}

function writeAppRegistry(registryFile, apps) {
  const sorted = Object.fromEntries(Object.entries(apps).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(registryFile, `${JSON.stringify({ apps: sorted }, null, 2)}\n`, 'utf8')
}

// 「接入协议」判定：根目录下有协议目录，且协议目录里有动作字典与应用工具。
export function inspectAppProtocol(appDir) {
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    throw new Error(`应用目录不存在：${appDir}`)
  }
  const protocolDir = path.join(appDir, appProtocolDirName)
  if (!existsSync(protocolDir) || !statSync(protocolDir).isDirectory()) {
    throw new Error(`应用未接入协议，缺少协议目录：${protocolDir}`)
  }
  if (!existsSync(path.join(protocolDir, appProtocolFileName))) {
    throw new Error(`应用未接入协议，缺少动作字典：${path.join(protocolDir, appProtocolFileName)}`)
  }
  const toolFile = readdirSync(protocolDir).find(
    entry => entry.startsWith(appToolFilePrefix) && statSync(path.join(protocolDir, entry)).isFile(),
  )
  if (!toolFile) {
    throw new Error(`应用未接入协议，协议目录内找不到应用工具：${protocolDir}${path.sep}${appToolFilePrefix}*`)
  }
  return { appDir, protocolDir, toolFile }
}

export function registerApp(registryFile, appName, appDir) {
  if (!isSafeAppName(appName)) throw new Error(`应用名不合法：${appName}`)
  if (!path.isAbsolute(appDir)) throw new Error(`登记路径必须是绝对路径：${appDir}`)
  const normalizedDir = path.resolve(appDir)
  inspectAppProtocol(normalizedDir)
  const apps = readAppRegistry(registryFile)
  const previousDir = apps[appName] ?? ''
  apps[appName] = normalizedDir
  writeAppRegistry(registryFile, apps)
  return { appName, appDir: normalizedDir, previousDir }
}

export function resolveRegisteredApp(registryFile, appName) {
  const appDir = readAppRegistry(registryFile)[appName]
  if (!appDir) {
    throw new Error(`应用未登记：${appName}（注册表 ${registryFile}）；请先执行 --register 登记应用根目录`)
  }
  return { appName, ...inspectAppProtocol(appDir) }
}

// 全量体检：逐条判定，不因单条失败中断，由调用方决定如何呈现与是否失败。
export function inspectRegisteredApps(registryFile) {
  return Object.entries(readAppRegistry(registryFile))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([appName, appDir]) => {
      try {
        return { appName, appDir, ok: true, ...inspectAppProtocol(appDir) }
      } catch (error) {
        return { appName, appDir, ok: false, error: error.message }
      }
    })
}
