import type { HyperCortexNoteFaceManifestV2 } from './noteFaces'
import type { HyperCortexNoteManifestV1 } from './noteSchema'

export type HyperCortexNoteVersionSummary = {
  versionId: string
  commitName: string
  createdAtMs: number
  contentHash: string
  title: string
  description: string
  faceIds: string[]
}

export type HyperCortexNoteVersionFaceSnapshot = {
  manifest: HyperCortexNoteFaceManifestV2
  content: string
}

export type HyperCortexNoteVersionSnapshot = {
  schemaVersion: number
  versionId: string
  noteId: string
  packageDir: string
  commitName: string
  createdAtMs: number
  contentHash: string
  manifest: HyperCortexNoteManifestV1
  faces: Record<string, HyperCortexNoteVersionFaceSnapshot>
}
