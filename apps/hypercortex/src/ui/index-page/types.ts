import type { AssetEntry } from '../../assetTypes'
import type { NoteMeta } from '../../core'

export type AddKind = 'folder' | 'note' | 'asset'

export type AddMode = 'existing' | 'create'

export type DeleteEntityTarget =
  | { kind: 'folder'; title: string; folderId: string }
  | { kind: 'note'; title: string; note: NoteMeta }
  | { kind: 'asset'; title: string; asset: AssetEntry }

export type EditFolderTarget = {
  folderId: string
  title: string
  description: string
}

export type ResizeDraft = {
  refId: string
  w: number
  h: number
}

export type ResizeHandleDirection = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se'
