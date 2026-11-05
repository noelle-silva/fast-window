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

// 读取结果必须区分四种语义，绝不能把「读失败」折叠成「没有偏好」：
//   - loaded：盘上存在结构有效的偏好，可作为视图与写入基线；
//   - missing：通道确实不存在（首次运行 / 从未保存过）；
//   - invalid：通道存在但形状损坏；
//   - failed：存储读取抛错（文件锁、传输中断、进程重启窗口）。
//
// invalid / failed 只能生成内存暂行视图，下一次保存必须被熔断闸门拦下。
export type ClientPreferencesRead =
  | { status: 'loaded'; preferences: ClientPreferences }
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'failed'; error: unknown }

export type ClientPreferencesReadStatus = ClientPreferencesRead['status']

// 写入熔断闸门拒绝覆盖时使用的固定错误类型：调用方可以据此提示用户，
// 而不是把「没有保存」伪装成成功。
export class ClientPreferencesWriteBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClientPreferencesWriteBlockedError'
  }
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
//   - 读取抛错是 failed，绝不能伪装成 missing；
//   - 通道缺失（null / 无 ui+settings）是 missing，代表真正的首次运行；
//   - 通道存在但形状损坏是 invalid，代表「盘上有东西但不能安全接管」；
//   - settings 再做一次投影自有过滤，旧数据里的 providers / stickers /
//     assist 子键不会因为历史脏数据重新进入偏好链路。
export async function readClientPreferences(storage: ClientPreferencesStorage): Promise<ClientPreferencesRead> {
  let raw: any = null
  try {
    raw = await storage.get(CLIENT_PREFERENCES_KEY)
  } catch (error) {
    return { status: 'failed', error }
  }
  if (raw === null || raw === undefined) return { status: 'missing' }
  if (!isRecord(raw)) return { status: 'invalid' }
  const hasUi = isRecord(raw.ui)
  const hasSettings = isRecord(raw.settings)
  if (!hasUi && !hasSettings) return { status: 'missing' }
  return {
    status: 'loaded',
    preferences: {
      ui: cloneJsonData(objectRecord(raw.ui)),
      settings: cloneJsonData(projectionOwnedSettings(objectRecord(raw.settings))),
    },
  }
}

// preferencesOfRead 是「视图回落」的唯一取值入口：只有可信读取才提供偏好，
// invalid / failed 必须由调用方使用内存暂行视图回落。
export function preferencesOfRead(read: ClientPreferencesRead): ClientPreferences | null {
  return read.status === 'loaded' ? read.preferences : null
}

// trustedClientPreferencesRead 判断读取结果能否作为落盘基线：
// missing 是可信的（确实没有历史数据），loaded 是可信的；
// invalid / failed 都必须熔断。
export function trustedClientPreferencesRead(read: ClientPreferencesRead): boolean {
  return read.status === 'loaded' || read.status === 'missing'
}
