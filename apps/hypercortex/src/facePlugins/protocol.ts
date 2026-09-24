import type * as React from 'react'

import type { NoteMeta, VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { HyperCortexNoteResourceRef } from '../noteSchema'
import type { FaceDeclaration } from '../shared/faceDeclarations'

/**
 * 笔记面视窗协议：宿主只按类型标识挂载插件视窗；
 * 视窗的界面实现属于插件模块，宿主不识别具体类型。
 *
 * 声明由数据半包唯一持有（后端 listFacePlugins 出口），
 * 视窗插件只登记界面实现；设置界面按声明渲染，不在插件里重复声明。
 */

export type { FaceSettingEnumField, FaceSettingField, FaceSettingNumberField, FaceSettingOption } from '../shared/faceDeclarations'

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
  /** 当前面的生效设置（宿主按「笔记级 > 全局级 > 声明默认」解析后交给视窗）。 */
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

/** 静态内容预览输入：宿主在版本历史等只读场景按类型挂载。 */
export type FaceContentPreviewProps = {
  content: string
}

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
  /** 只读内容预览（版本历史等宿主场景）；缺省时宿主按纯文本展示内容。 */
  ContentPreview?: React.ComponentType<FaceContentPreviewProps>
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

/**
 * 声明与视窗实现的一致性校验（声明写入运行时仓库时执行，快速失败）：
 * 每个声明类型必须有阅读态视窗；可编辑面必须有编辑态视窗与草稿存储。
 */
export function validateFaceViewPluginsAgainstDeclarations(declarations: readonly FaceDeclaration[]): void {
  const seen = new Set<string>()
  for (const declaration of declarations) {
    const kind = String(declaration.kind || '').trim()
    if (!kind) throw new Error('面声明缺少类型标识')
    if (seen.has(kind)) throw new Error(`面声明类型标识重复：${kind}`)
    if (!declaration.capabilities || typeof declaration.capabilities !== 'object') {
      throw new Error(`面声明缺少能力画像：${kind}`)
    }
    if (!Array.isArray(declaration.settings)) throw new Error(`面声明缺少设置清单：${kind}`)
    seen.add(kind)
    const plugin = getFaceViewPlugin(kind)
    if (!plugin) throw new Error(`面视窗缺失：${kind}`)
    if (declaration.capabilities.editable && !plugin.EditView) {
      throw new Error(`可编辑面缺少编辑态视窗：${kind}`)
    }
    if (declaration.capabilities.editable && !plugin.createDraftStore) {
      throw new Error(`可编辑面缺少草稿存储：${kind}`)
    }
  }
}
