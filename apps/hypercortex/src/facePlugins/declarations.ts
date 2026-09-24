import * as React from 'react'

import type { HyperCortexNoteFaceManifestV2, HyperCortexNoteFaceSettingsV2 } from '../noteFaces'
import type { FaceDeclaration } from '../shared/faceDeclarations'
import { validateFaceViewPluginsAgainstDeclarations } from './protocol'

/**
 * 运行时声明仓库（唯一事实源）：由 App 启动时从后端拉取一次写入，
 * 网关、界面与装配校验都从这里读取声明，不在前端保留任何本地声明镜像。
 */

let declarations: readonly FaceDeclaration[] = []
const listeners = new Set<() => void>()

/** 全部声明（顺序为后端声明顺序）。 */
export function getFaceDeclarations(): readonly FaceDeclaration[] {
  return declarations
}

/** 声明顺序的类型标识清单（面偏好的已知类型入参）。 */
export function getFaceKindOrder(): string[] {
  return declarations.map(declaration => declaration.kind)
}

/** 可创建面的声明清单。 */
export function getCreatableFaceDeclarations(): readonly FaceDeclaration[] {
  return declarations.filter(declaration => declaration.capabilities.creatable)
}

/** 按类型标识取声明；未知类型返回 null（宿主按占位处理）。 */
export function getFaceDeclaration(kind: string): FaceDeclaration | null {
  const id = String(kind || '').trim()
  return declarations.find(declaration => declaration.kind === id) || null
}

/** 按类型标识取声明；缺失直接快速失败。 */
export function requireFaceDeclaration(kind: string): FaceDeclaration {
  const declaration = getFaceDeclaration(kind)
  if (!declaration) throw new Error(`未知笔记面类型：${kind}`)
  return declaration
}

/** 订阅声明变化（useSyncExternalStore 入口）。 */
export function subscribeFaceDeclarations(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 写入声明：装配校验（每个声明类型必须有阅读态视窗、可编辑面必须有编辑态视窗与草稿存储）不通过直接快速失败。 */
export function setFaceDeclarations(list: readonly FaceDeclaration[]): void {
  const next = Array.isArray(list) ? list.slice() : []
  validateFaceViewPluginsAgainstDeclarations(next)
  declarations = next
  for (const listener of Array.from(listeners)) listener()
}

/** 宿主订阅钩子：声明就绪或更新时触发重渲染。 */
export function useFaceDeclarations(): readonly FaceDeclaration[] {
  return React.useSyncExternalStore(subscribeFaceDeclarations, getFaceDeclarations, getFaceDeclarations)
}

export type FaceManifestOverrides = {
  id?: string
  title?: string
  file?: string
  settings?: HyperCortexNoteFaceSettingsV2 | null
  createdAtMs?: number
  updatedAtMs?: number
}

/** 由声明构建面清单：新建草稿与新增面的唯一构造入口。 */
export function faceManifestFromDeclaration(declaration: FaceDeclaration, overrides?: FaceManifestOverrides): HyperCortexNoteFaceManifestV2 {
  const createdAtMs = Number(overrides?.createdAtMs) > 0 ? Number(overrides?.createdAtMs) : 0
  const updatedAtMs = Number(overrides?.updatedAtMs) > 0 ? Number(overrides?.updatedAtMs) : createdAtMs
  const rawSettings = overrides?.settings
  const settings: HyperCortexNoteFaceSettingsV2 = rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
    ? { ...rawSettings }
    : {}
  return {
    id: String(overrides?.id || '').trim() || declaration.defaultFaceId,
    kind: declaration.kind,
    title: String(overrides?.title || '').trim() || declaration.label,
    file: String(overrides?.file || '').trim() || declaration.defaultFileName,
    settings,
    capabilities: { ...declaration.capabilities },
    createdAtMs,
    updatedAtMs,
  }
}
