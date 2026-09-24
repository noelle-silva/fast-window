import type { HyperCortexNoteFaceCapabilitiesV2 } from '../noteFaces'

/**
 * 笔记面声明（协议 v1）：与后端 listFacePlugins 返回的 JSON 逐字段对齐。
 * 数据半包唯一声明，网关与界面共用；宿主不持有任何具体面的声明镜像。
 */

/** 枚举设置项的一个可选值。 */
export type FaceSettingOption = {
  value: string
  label: string
  description?: string
}

type FaceSettingFieldBase = {
  key: string
  /** 笔记级设置块标题。 */
  label: string
  /** 全局面板块标题；缺省时复用笔记级标题。 */
  globalLabel?: string
  /** 全局面板说明，可含 {value} 占位（当前生效的全局值）。 */
  description?: string
  /** 笔记级说明，可含 {global} 占位（全局值）。 */
  noteDescription?: string
  /** 数值展示格式；percent 表示 0.95 → 95%。 */
  format?: 'percent'
}

export type FaceSettingEnumField = FaceSettingFieldBase & {
  kind: 'enum'
  default: string
  options: FaceSettingOption[]
}

export type FaceSettingNumberField = FaceSettingFieldBase & {
  kind: 'number'
  default: number
  min: number
  max: number
  step: number
}

/** 面可配置项：声明形态与默认值，宿主按声明做通用解析与渲染。 */
export type FaceSettingField = FaceSettingEnumField | FaceSettingNumberField

/** 一种面的完整声明：类型标识、展示名、默认面标识/文件名、能力画像与可配置项。 */
export type FaceDeclaration = {
  kind: string
  label: string
  defaultFaceId: string
  defaultFileName: string
  capabilities: HyperCortexNoteFaceCapabilitiesV2
  protocolVersion: number
  /** 全局面板标题（如「HTML 面显示策略」）；缺省由界面生成。 */
  settingsTitle?: string
  /** 全局面板说明。 */
  settingsIntro?: string
  settings: FaceSettingField[]
}
