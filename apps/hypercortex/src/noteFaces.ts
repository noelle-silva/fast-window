/**
 * 笔记面数据模型的纯类型：随笔记描述文件持久化的面清单形态与读取结果。
 * 面的声明（能力、默认标识/文件名、设置项）唯一由后端声明出口给出，
 * 前端不再持有任何具体类型的适配器与常量。
 */

export type HyperCortexNoteFaceSettingsV2 = Record<string, unknown>

export type HyperCortexNoteFaceCapabilitiesV2 = {
  editable: boolean
  searchable: boolean
  previewable: boolean
  creatable: boolean
  deletable: boolean
}

export type HyperCortexNoteFaceManifestV2 = {
  id: string
  kind: string
  title: string
  file: string
  settings: HyperCortexNoteFaceSettingsV2
  capabilities: HyperCortexNoteFaceCapabilitiesV2
  createdAtMs?: number
  updatedAtMs?: number
}

export type HyperCortexNoteFaceDoc = {
  id: string
  packageDir: string
  noteId: string
  noteTitle: string
  noteDescription: string
  face: HyperCortexNoteFaceManifestV2
  content: string
  exists: boolean
  createdAtMs: number
  updatedAtMs: number
  schemaVersion: number
}
