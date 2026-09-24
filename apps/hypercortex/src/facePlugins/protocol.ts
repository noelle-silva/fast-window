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
}

/** 阅读态视窗输入。 */
export type FaceReadViewProps = {
  content: string
  visible: boolean
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
}

/** 面视窗插件：一个类型标识的界面半包。 */
export type FaceViewPlugin = {
  kind: string
  /** 视窗即时状态的协议默认值（宿主在重置时使用）。 */
  defaultViewState: Record<string, unknown>
  ReadView: React.ComponentType<FaceReadViewProps>
  EditView?: React.ComponentType<FaceEditViewProps>
  Toolbar?: React.ComponentType<FaceToolbarProps>
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
