import * as React from 'react'
import { Box } from '@mui/material'

import type { NoteMeta, VaultScope } from '../../core'
import type { HyperCortexGateway } from '../../gateway'
import type { AssetLookup } from '../../assetLookup'
import { resolveAssetRef } from '../../assetLookup'
import type { HyperCortexFavoritesDocV1 } from '../../favorites'
import type { SidebarPreviewTarget } from './previewTarget'
import { NotePreviewSurface } from './NotePreviewSurface'
import { AssetPreviewPane } from './AssetPreviewPane'
import { FolderPreviewSurface } from './FolderPreviewSurface'

/**
 * 按住预览的覆盖层：以覆盖式临时展示替代主区域内容，不改变标签页与选中态。
 * 覆盖层自身可滚动，鼠标在原位滚轮即滚动预览内容。
 */
export function SidebarHoldPreviewOverlay(props: {
  gateway: HyperCortexGateway
  scope: VaultScope
  target: SidebarPreviewTarget
  noteIndex: Record<string, NoteMeta>
  assetLookup: AssetLookup
  favoritesDoc: HyperCortexFavoritesDocV1 | null
  noteIndexMap: Record<string, { title: string; faceIds?: string[] }>
  allNotesById: Record<string, NoteMeta>
  facePluginGlobalSettings: Record<string, Record<string, unknown>>
  globalFaceKindOrder: readonly string[]
  /** 覆盖层滚动容器：边栏滚轮转发据此滚动预览内容。 */
  scrollRef?: React.Ref<HTMLDivElement>
}): React.ReactNode {
  const { gateway, scope, target, noteIndex, assetLookup, favoritesDoc, noteIndexMap, allNotesById, facePluginGlobalSettings, globalFaceKindOrder, scrollRef } = props

  const body = (() => {
    if (target.kind === 'note') {
      const note = noteIndex[target.noteId]
      if (!note) return null
      return (
        <NotePreviewSurface
          gateway={gateway}
          scope={scope}
          note={note}
          noteIndexMap={noteIndexMap}
          allNotesById={allNotesById}
          facePluginGlobalSettings={facePluginGlobalSettings}
          globalFaceKindOrder={globalFaceKindOrder}
        />
      )
    }
    if (target.kind === 'asset') {
      const asset = resolveAssetRef(assetLookup, target.assetRef)
      if (!asset) return null
      return <AssetPreviewPane gateway={gateway} scope={scope} asset={asset} />
    }
    if (!favoritesDoc) return null
    return <FolderPreviewSurface doc={favoritesDoc} folderId={target.folderId} noteIndex={noteIndex} assetLookup={assetLookup} />
  })()

  return (
    <Box
      ref={scrollRef}
      data-hc-hold-preview-overlay="1"
      sx={{
        position: 'absolute',
        inset: 0,
        // 低于边栏悬停覆盖层（zIndex 20）：悬停展开的边栏面板始终压在预览之上。
        zIndex: 10,
        bgcolor: 'var(--hc-surface)',
        overflow: 'auto',
        overscrollBehavior: 'contain',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 12px 32px var(--hc-shadow)',
      }}
    >
      {body}
    </Box>
  )
}
