// 应用清单（fw-app.json）：读取、按协议校验结构、提取发布与校验所需的事实。
// 发布、下架与 --verify 共用这一份规则；服务声明结构与宿主 src-tauri/src/app_lifecycle/service_declaration.rs 保持一致。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { parseReservedNameExemptions } from '../app-template/fast-window-dev-tool.mjs'
import { isSafeId, normalizeRelativePath } from './fast-window-dev-store-common.mjs'

export const manifestFileName = 'fw-app.json'

const appTypeDesktop = 'desktop-app'
const appTypeService = 'service-app'
const commandTitleMaxLength = 80
const iconExtensions = new Set(['.png', '.svg'])

// 协议定义的字段白名单：清单里出现白名单外的字段一律拒绝，废弃字段无法残留。
const allowedKeys = {
  manifest: ['type', 'id', 'name', 'description', 'versionSource', 'package', 'service', 'commands', 'reservedNameExemptions'],
  package: ['windowsExecutable', 'icon'],
  command: ['id', 'title'],
  service: ['start', 'ready', 'stop'],
  serviceStart: ['args', 'environment'],
  serviceReady: ['type', 'match', 'timeoutSeconds'],
  serviceStop: ['type'],
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

function assertObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`清单 ${field} 必须是对象`)
  }
  return value
}

function assertKnownKeys(value, field, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`清单 ${field} 含不支持的字段：${key}`)
  }
}

function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') throw new Error(`清单 ${field} 不能为空`)
  return text
}

function executableFact(value) {
  const executable = normalizeRelativePath(value, 'package.windowsExecutable')
  if (!executable.toLowerCase().endsWith('.exe')) {
    throw new Error(`清单 package.windowsExecutable 必须指向 .exe：${executable}`)
  }
  return executable
}

function iconFact(value) {
  const icon = normalizeRelativePath(value, 'package.icon')
  if (!iconExtensions.has(path.extname(icon).toLowerCase())) {
    throw new Error('清单 package.icon 只支持 .png 或 .svg 图标')
  }
  return icon
}

function commandsFact(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('清单 commands 必须是数组')
  const seen = new Set()
  return value.map((item, index) => {
    const field = `commands[${index}]`
    assertKnownKeys(assertObject(item, field), field, allowedKeys.command)
    const id = String(item.id ?? '').trim()
    const title = String(item.title ?? '').trim()
    if (!isSafeId(id)) throw new Error(`清单 ${field}.id 不合法：${id}`)
    if (seen.has(id)) throw new Error(`清单 ${field}.id 重复：${id}`)
    if (title === '') throw new Error(`清单 ${field}.title 不能为空`)
    if ([...title].length > commandTitleMaxLength) {
      throw new Error(`清单 ${field}.title 不能超过 ${commandTitleMaxLength} 字`)
    }
    seen.add(id)
    return { id, title }
  })
}

function assertServiceStart(start) {
  if (start === undefined) return
  assertKnownKeys(assertObject(start, 'service.start'), 'service.start', allowedKeys.serviceStart)
  if (start.args !== undefined && !(Array.isArray(start.args) && start.args.every(arg => typeof arg === 'string'))) {
    throw new Error('清单 service.start.args 必须是字符串数组')
  }
  if (start.environment === undefined) return
  for (const [key, value] of Object.entries(assertObject(start.environment, 'service.start.environment'))) {
    if (key === '' || key.includes('=') || key.includes('\0')) {
      throw new Error(`清单 service.start.environment 变量名不合法：${key}`)
    }
    if (typeof value !== 'string' || value.includes('\0')) {
      throw new Error(`清单 service.start.environment 变量值不合法：${key}`)
    }
  }
}

function assertServiceReady(ready) {
  if (ready === undefined) throw new Error('清单 service.ready 不能为空')
  assertKnownKeys(assertObject(ready, 'service.ready'), 'service.ready', allowedKeys.serviceReady)
  const kind = String(ready.type ?? '').trim()
  if (kind !== 'log') throw new Error(`清单 service.ready.type 必须为 log：${kind || '(empty)'}`)
  requiredText(ready.match, 'service.ready.match')
  const timeout = ready.timeoutSeconds
  if (timeout !== undefined && !(Number.isSafeInteger(timeout) && timeout > 0)) {
    throw new Error(`清单 service.ready.timeoutSeconds 必须为正整数：${timeout}`)
  }
}

function assertServiceStop(stop) {
  if (stop === undefined) throw new Error('清单 service.stop 不能为空')
  assertKnownKeys(assertObject(stop, 'service.stop'), 'service.stop', allowedKeys.serviceStop)
  const kind = String(stop.type ?? '').trim()
  if (kind !== 'terminate') throw new Error(`清单 service.stop.type 必须为 terminate：${kind || '(empty)'}`)
}

// 类型与服务段一致：桌面应用不带服务段，服务应用必须带且结构合法。
function serviceFact(type, service) {
  if (type === appTypeDesktop) {
    if (service !== undefined) throw new Error(`清单 type 为 ${appTypeDesktop} 时不允许携带 service 段`)
    return undefined
  }
  if (service === undefined) throw new Error(`清单 type 为 ${appTypeService} 时必须提供 service 段`)
  assertKnownKeys(assertObject(service, 'service'), 'service', allowedKeys.service)
  assertServiceStart(service.start)
  assertServiceReady(service.ready)
  assertServiceStop(service.stop)
  return service
}

// 校验整份清单并提取事实；任何一处不合协议都直接报错。
export function manifestFacts(manifest) {
  assertKnownKeys(assertObject(manifest, '顶层'), '顶层', allowedKeys.manifest)
  const type = String(manifest.type ?? '').trim()
  if (type !== appTypeDesktop && type !== appTypeService) {
    throw new Error(`清单 type 必须为 ${appTypeDesktop} 或 ${appTypeService}：${type || '(empty)'}`)
  }
  const id = String(manifest.id ?? '').trim()
  if (!isSafeId(id)) {
    throw new Error(`清单 id 不合法：${id}`)
  }
  const pkg = assertObject(manifest.package, 'package')
  assertKnownKeys(pkg, 'package', allowedKeys.package)
  return {
    type,
    id,
    name: requiredText(manifest.name, 'name'),
    description: requiredText(manifest.description, 'description'),
    versionSource: normalizeRelativePath(manifest.versionSource, 'versionSource'),
    executable: executableFact(pkg.windowsExecutable),
    icon: iconFact(pkg.icon),
    service: serviceFact(type, manifest.service),
    commands: commandsFact(manifest.commands),
    reservedNameExemptions: parseReservedNameExemptions(manifest.reservedNameExemptions),
  }
}
