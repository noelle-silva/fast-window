import type { AssetEntry } from '../../assetTypes'
import type { NoteMeta } from '../../core'

export type AddKind = 'folder' | 'note' | 'asset'

export type DeleteEntityTarget =
  | { kind: 'folder'; title: string; folderId: string }
  | { kind: 'note'; title: string; note: NoteMeta }
  | { kind: 'asset'; title: string; asset: AssetEntry }

export type DragDraft = {
  refId: string
  x: number
  y: number
}

export type ResizeDraft = {
  refId: string
  w: number
  h: number
}
