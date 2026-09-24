import type * as React from 'react'

import type { NoteMeta, VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { HyperCortexNoteResourceRef } from '../noteSchema'

/**
 * 笔记面视窗协议：宿主只按类型标识挂载插件视窗；
 * 视窗的界面实现属于插件模块，宿主不识别具体类型。
 *
 * 过程 2 过渡形态：内容与变更回调暂由宿主传入（宿主仍持草稿），
 * 「草稿归插件自持」在过程 4「宿主拆壳」统一落地。
 */

/** 宿主向面视窗提供的通用设施与上下文。 */
export type FaceViewContext = {
  gateway: HyperCortexGateway
  scope: VaultScope
  noteIndexMap: Record<string, { title: string; faceIds?: string[] }>
  /** 按笔记标识取元信息（引用跳转前的存在性判断）。 */
  getNoteMeta: (noteId: string) => NoteMeta | undefined
  /** 打开引用目标（可带目标面）。 */
  onOpenNote: (note: NoteMeta, faceId?: string) => void
  /** 媒体播放状态上报。 */
  onPlayingChange?: (playing: boolean) => void
  /** 上传粘贴附件，返回资产描述（占位符语法由面自己决定）。 */
  uploadFiles: (files: File[]) => Promise<HyperCortexNoteResourceRef[]>
  /** 把新上传的资产登记进当前笔记的资源清单。 */
  onResourcesAdded: (resources: HyperCortexNoteResourceRef[]) => void
  /** 当前面的生效设置（宿主按「笔记级 > 全局级 > 默认」解析后交给视窗）。 */
  settings: Record<string, unknown>
  /** 当前面的笔记级原始覆盖值（用于标识是否覆盖了全局）。 */
  noteSettings: Record<string, unknown>
  /** 当前类型的全局设置原始值。 */
  globalSettings: Record<string, unknown>
  /** 写回当前面的笔记级设置补丁（null 清除键）；笔记尚未保存时不可用。 */
  updateSettings?: (patch: Record<string, unknown | null>) => Promise<void>
}

/** 阅读态视窗输入。 */
export type FaceReadViewProps = {
  content: string
  visible: boolean
  viewState: Record<string, unknown>
  onViewStateChange: (patch: Record<string, unknown>) => void
  context: FaceViewContext
}

/** 编辑态视窗输入。 */
export type FaceEditViewProps = FaceReadViewProps & {
  onChange: (next: string) => void
  viewState: Record<string, unknown>
  onViewStateChange: (patch: Record<string, unknown>) => void
}

/** 面可配置项：声明形态与默认值，宿主按声明做通用解析与渲染。 */
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

export type FaceSettingField = FaceSettingEnumField | FaceSettingNumberField

/** 工具条视窗输入：面专属控件在宿主预留的插槽位置渲染。 */
export type FaceToolbarProps = {
  editing: boolean
  disabled: boolean
  viewState: Record<string, unknown>
  onViewStateChange: (patch: Record<string, unknown>) => void
  context: FaceViewContext
}

/** 宿主在工具条两侧预留的插槽位置。 */
export type FaceToolbarSlot = 'left' | 'right'

/** 面草稿存储：草稿归插件自持；宿主只取内容与脏标记，不保存草稿本身。 */
export type FaceDraftStore = {
  getContent: () => string
  setContent: (next: string) => void
  subscribe: (listener: () => void) => () => void
  /** 保存/放弃后把草稿与已保存内容对齐。 */
  reset: (content: string) => void
  isDirty: () => boolean
}

/** 面视窗插件：一个类型标识的界面半包。 */
export type FaceViewPlugin = {
  kind: string
  /** 视窗即时状态的协议默认值（宿主在重置时使用）。 */
  defaultViewState: Record<string, unknown>
  ReadView: React.ComponentType<FaceReadViewProps>
  EditView?: React.ComponentType<FaceEditViewProps>
  /** 为可编辑面创建草稿存储；视图编辑与宿主保存共用同一份草稿。
   *  savedContent 为已保存基线（会话迁移时用于保留未保存状态），缺省等于当前内容。 */
  createDraftStore?: (input: { faceId: string; initialContent: string; savedContent?: string }) => FaceDraftStore
  /** 面专属工具条控件：按插槽位置交给宿主渲染。 */
  Toolbars?: Partial<Record<FaceToolbarSlot, React.ComponentType<FaceToolbarProps>>>
  /** 面自己声明的可配置项；宿主按统一优先级解析并通用渲染设置界面。 */
  settings?: FaceSettingField[]
  /** 全局面板标题（如「HTML 面显示策略」）。 */
  settingsTitle?: string
  /** 全局面板说明。 */
  settingsIntro?: string
}

const registry = new Map<string, FaceViewPlugin>()

/** 装配期注册视窗插件；声明不完整或类型重复直接快速失败。 */
export function registerFaceViewPlugin(plugin: FaceViewPlugin): void {
  const kind = String(plugin.kind || '').trim()
  if (!kind) throw new Error('面视窗插件缺少类型标识')
  if (!plugin.ReadView) throw new Error(`面视窗插件缺少阅读态视窗：${kind}`)
  if (registry.has(kind)) throw new Error(`面视窗插件重复注册：${kind}`)
  registry.set(kind, plugin)
}

/** 按类型标识取视窗插件。 */
export function getFaceViewPlugin(kind: string): FaceViewPlugin | null {
  return registry.get(String(kind || '').trim()) || null
}

/** 全部已注册视窗插件。 */
export function listFaceViewPlugins(): FaceViewPlugin[] {
  return Array.from(registry.values())
}
