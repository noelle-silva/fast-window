// 投影自有 settings 的唯一事实源。
//
// 本文件与 backend-go/projection_helpers.go 的
// mergeProjectionSettingsForMetaSave 一一对应：
//   - 派生物（providers）：每次 meta() 重新组装，不参与偏好比较；
//   - 专用通道（stickers）：由 stickers 存储通道维护，保存 meta 时后端保留旧值；
//   - AI 微服务配置（aiServices 的 4 个 assist 子键）：由
//     aiChat.assistConfig.set 写入，不属于客户端偏好。
//
// 新增或调整过滤名单时只改这里，禁止在 splitStorage / 测试里复制名单。

export const PROJECTION_DERIVED_SETTING_KEYS = ['providers'] as const

export const PROJECTION_DEDICATED_SETTING_KEYS = ['stickers'] as const

export const PROJECTION_ASSIST_SETTING_KEYS = [
  'stickerNaming',
  'mermaidFix',
  'chatTitleNaming',
  'contextCompression',
] as const

// 顶层完全不属于投影自有 settings 的键。
export const PROJECTION_TOP_LEVEL_NON_OWNED_SETTING_KEYS = [
  ...PROJECTION_DERIVED_SETTING_KEYS,
  ...PROJECTION_DEDICATED_SETTING_KEYS,
] as const

type SettingsRecord = Record<string, any>

function settingsRecord(value: unknown): SettingsRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as SettingsRecord) : {}
}

// stripProjectionAssistSettings 只移除 aiServices 下的 assist 子键，
// 保留同一对象内的其它本地键（后端同样只剥离 assist 子键）。
// 返回浅拷贝，不修改入参。
export function stripProjectionAssistSettings(settings: unknown): SettingsRecord {
  const source = settingsRecord(settings)
  const aiServices = source.aiServices
  if (!aiServices || typeof aiServices !== 'object' || Array.isArray(aiServices)) return { ...source }
  const ownedAiServices = { ...(aiServices as SettingsRecord) }
  for (const key of PROJECTION_ASSIST_SETTING_KEYS) delete ownedAiServices[key]
  return { ...source, aiServices: ownedAiServices }
}

// projectionOwnedSettings 返回「投影自有 settings」的独立顶层快照：
// 已剥离派生物、专用通道与 assist 子键。其它字段（外观 / 字体 / 布局 /
// 壁纸 / 主题等）原样保留，因此变化仍会被偏好指纹检测到。
export function projectionOwnedSettings(settings: unknown): SettingsRecord {
  const owned = stripProjectionAssistSettings(settings)
  for (const key of PROJECTION_TOP_LEVEL_NON_OWNED_SETTING_KEYS) delete owned[key]
  return owned
}
