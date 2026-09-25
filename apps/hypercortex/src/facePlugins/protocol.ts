import type * as React from 'react'

import type { NoteMeta, VaultScope } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { HyperCortexNoteResourceRef } from '../noteSchema'
import type { FaceDeclaration, FaceSettingField, FaceSettingOption } from '../shared/faceDeclarations'

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
  /** 面视窗当前的实际编辑态：不可编辑的面始终为 false（即使宿主处于编辑模式）。 */
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

/**
 * 面内容存储：面内容的唯一持有者（由插件实现）。
 * 可编辑面用它承载未保存草稿，只读面用它承载静态内容；宿主只取内容与脏标记，不持久化内容本身。
 */
export type FaceContentStore = {
  getContent: () => string
  setContent: (next: string) => void
  subscribe: (listener: () => void) => () => void
  /** 保存/放弃后把当前内容与已保存基线对齐。 */
  reset: (content: string) => void
  /** 是否存在未保存改动；只读面恒为 false。 */
  isDirty: () => boolean
}

/** 面视窗插件：一个类型标识的界面半包。 */
export type FaceViewPlugin = {
  kind: string
  /** 视窗即时状态的协议默认值（宿主在重置时使用）。 */
  defaultViewState: Record<string, unknown>
  ReadView: React.ComponentType<FaceReadViewProps>
  EditView?: React.ComponentType<FaceEditViewProps>
  /** 为面创建内容存储（所有面必交）：面视窗渲染与宿主保存共用同一份内容；
   *  可编辑面的未保存改动通过脏标记上报，只读面恒不脏。
   *  savedContent 为已保存基线（会话迁移时用于保留未保存状态），缺省等于当前内容。 */
  createContentStore: (input: { faceId: string; initialContent: string; savedContent?: string }) => FaceContentStore
  /** 面专属工具条控件：按插槽位置交给宿主渲染。 */
  Toolbars?: Partial<Record<FaceToolbarSlot, React.ComponentType<FaceToolbarProps>>>
  /** 只读内容预览（版本历史等宿主场景）；缺省时宿主按纯文本展示内容。 */
  ContentPreview?: React.ComponentType<FaceContentPreviewProps>
}

const registry = new Map<string, FaceViewPlugin>()

/** 装配期注册视窗插件；结构不完整或类型重复直接快速失败。 */
export function registerFaceViewPlugin(plugin: FaceViewPlugin): void {
  const kind = String(plugin.kind || '').trim()
  if (!kind) throw new Error('面视窗插件缺少类型标识')
  if (!plugin.ReadView) throw new Error(`面视窗插件缺少阅读态视窗：${kind}`)
  if (typeof plugin.createContentStore !== 'function') throw new Error(`面视窗插件缺少内容存储：${kind}`)
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

/** 前端支持的协议版本；后端声明与视窗注册必须与本版本一致。 */
const SUPPORTED_PROTOCOL_VERSION = 1

/**
 * 声明与视窗实现的一致性校验（声明写入运行时仓库时执行，快速失败）：
 * 校验协议版本、能力字段类型、设置清单形态，以及声明类型与视窗实现的一致性。
 * 任何不合法直接启动报错，不做静默降级。
 */
export function validateFaceViewPluginsAgainstDeclarations(declarations: readonly FaceDeclaration[]): void {
  if (!Array.isArray(declarations) || declarations.length === 0) {
    throw new Error('面声明清单为空')
  }
  const seen = new Set<string>()
  for (const declaration of declarations) {
    const kind = String(declaration.kind || '').trim()
    if (!kind) throw new Error('面声明缺少类型标识')
    if (seen.has(kind)) throw new Error(`面声明类型标识重复：${kind}`)
    if (declaration.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
      throw new Error(`面声明协议版本不匹配：${kind} 为 ${declaration.protocolVersion}，需要 ${SUPPORTED_PROTOCOL_VERSION}`)
    }
    validateFaceCapabilities(kind, declaration.capabilities)
    validateFaceSettingsDeclaration(kind, declaration.settings)
    seen.add(kind)
    const plugin = getFaceViewPlugin(kind)
    if (!plugin) throw new Error(`面视窗缺失：${kind}`)
    if (declaration.capabilities.editable && !plugin.EditView) {
      throw new Error(`可编辑面缺少编辑态视窗：${kind}`)
    }
    // previewable 属于协议保留字段（暂不消费）：允许无内容预览视窗，宿主按纯文本兜底展示。
  }
}

const CAPABILITY_KEYS = ['editable', 'searchable', 'previewable', 'creatable', 'deletable'] as const

function validateFaceCapabilities(kind: string, capabilities: FaceDeclaration['capabilities']): void {
  if (!capabilities || typeof capabilities !== 'object') {
    throw new Error(`面声明缺少能力画像：${kind}`)
  }
  for (const key of CAPABILITY_KEYS) {
    if (typeof capabilities[key] !== 'boolean') {
      throw new Error(`面声明的能力字段非法：${kind}.${key}`)
    }
  }
}

function validateFaceSettingsDeclaration(kind: string, settings: readonly FaceSettingField[]): void {
  if (!Array.isArray(settings)) throw new Error(`面声明缺少设置清单：${kind}`)
  const seenKeys = new Set<string>()
  for (const field of settings) {
    const key = String(field?.key || '').trim()
    if (!key) throw new Error(`面声明的设置项缺少键：${kind}`)
    if (seenKeys.has(key)) throw new Error(`面声明的设置项键重复：${kind}.${key}`)
    seenKeys.add(key)
    if (!String(field.label || '').trim()) throw new Error(`面声明的设置项缺少名称：${kind}.${key}`)
    if (field.kind === 'enum') {
      const options: FaceSettingOption[] = Array.isArray(field.options) ? field.options : []
      if (options.length === 0) {
        throw new Error(`面声明的枚举设置项缺少选项：${kind}.${key}`)
      }
      if (!options.some(option => option.value === field.default)) {
        throw new Error(`面声明的枚举设置项默认值不在选项中：${kind}.${key}`)
      }
      continue
    }
    if (field.kind === 'number') {
      const rangeValid = typeof field.min === 'number' && typeof field.max === 'number' && typeof field.step === 'number' && field.min < field.max && field.step > 0
      if (!rangeValid) throw new Error(`面声明的数值设置项范围非法：${kind}.${key}`)
      if (typeof field.default !== 'number' || field.default < field.min || field.default > field.max) {
        throw new Error(`面声明的数值设置项默认值越界：${kind}.${key}`)
      }
      continue
    }
    throw new Error(`面声明的设置项形态未知：${kind}.${key}`)
  }
}
