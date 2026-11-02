import { cloneJsonData } from '../core/jsonData'
import { CLIENT_PREFERENCES_KEY } from '../domain/constants'
import { projectionOwnedSettings } from '../domain/projectionSettings'

// 客户端偏好通道（client-state/preferences）的唯一事实源。
//
// 这里只处理「ui + 投影自有 settings」：providers / stickers / assist 子键
// 由 projectionOwnedSettings 统一剥离，禁止在本文件复制第二套名单。
// 通道本身走 client-state/ 本地状态区，因此读写都不要求 eucli-box 连接。
export type ClientPreferences = {
  ui: Record<string, any>
  settings: Record<string, any>
}

export type ClientPreferencesStorage = {
  get: (key: string) => Promise<any>
}

type JsonRecord = Record<string, any>

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// mergeJsonData 按「对象深合并、数组/标量整体覆盖」折叠偏好：
// 深层 aiServices 既要保留业务端 assist 配置，又要让客户端的本地键生效。
function mergeJsonData(base: JsonRecord, override: JsonRecord): JsonRecord {
  const merged: JsonRecord = {}
  for (const [key, value] of Object.entries(base)) merged[key] = cloneJsonData(value)
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key]
    merged[key] = isRecord(value) && isRecord(existing) ? mergeJsonData(existing, value) : cloneJsonData(value)
  }
  return merged
}

// overlayClientPreferences 把偏好叠加到 meta 快照上：
//   - 返回的两棵树都是独立深拷贝，调用方修改不会污染 meta / 存储快照；
//   - 没有偏好时等价于 clone meta，保持旧链路行为。
export function overlayClientPreferences(
  base: { ui?: unknown; settings?: unknown },
  preferences: ClientPreferences | null,
): ClientPreferences {
  const baseUi = objectRecord(base.ui)
  const baseSettings = objectRecord(base.settings)
  if (!preferences) {
    return { ui: cloneJsonData(baseUi), settings: cloneJsonData(baseSettings) }
  }
  return {
    ui: mergeJsonData(baseUi, preferences.ui),
    settings: mergeJsonData(baseSettings, preferences.settings),
  }
}

// createClientPreferencesSnapshot 是写盘前的唯一过滤入口：
// 入参是任意内存对象，返回独立快照 + 投影自有 settings。
export function createClientPreferencesSnapshot(ui: unknown, settings: unknown): ClientPreferences {
  return {
    ui: cloneJsonData(objectRecord(ui)),
    settings: cloneJsonData(projectionOwnedSettings(settings)),
  }
}

// readClientPreferences 只读客户端偏好通道，并且是「读边界归一化」：
//   - 通道缺失 / 形状损坏一律返回 null，由调用方回落到 meta；
//   - settings 再做一次投影自有过滤，旧数据里的 providers / stickers /
//     assist 子键不会因为历史脏数据重新进入偏好链路。
export async function readClientPreferences(storage: ClientPreferencesStorage): Promise<ClientPreferences | null> {
  let raw: any = null
  try {
    raw = await storage.get(CLIENT_PREFERENCES_KEY)
  } catch (_) {
    return null
  }
  if (!isRecord(raw)) return null
  const hasUi = isRecord(raw.ui)
  const hasSettings = isRecord(raw.settings)
  if (!hasUi && !hasSettings) return null
  return {
    ui: cloneJsonData(objectRecord(raw.ui)),
    settings: cloneJsonData(projectionOwnedSettings(objectRecord(raw.settings))),
  }
}
