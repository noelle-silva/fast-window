import type { HyperCortexNoteFaceManifestV2 } from './noteFaces'

/**
 * 笔记描述文件的纯类型：前端只消费后端出口的数据形态，
 * 不承担笔记包的读写与规范化（统一由后端执行）。
 */

export type HyperCortexNoteResourceRef = {
  assetId: string
  mime?: string
  ext?: string
  kind?: string
  name?: string
}

export type HyperCortexNoteManifestV2 = {
  schemaVersion: number
  id: string
  title: string
  description: string
  tags: string[]
  createdAtMs: number
  updatedAtMs: number
  faceOrder: string[]
  faces: Record<string, HyperCortexNoteFaceManifestV2>
  resources: HyperCortexNoteResourceRef[]
}

export type HyperCortexNoteManifestV1 = HyperCortexNoteManifestV2
