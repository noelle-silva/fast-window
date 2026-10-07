import * as React from 'react'
import { Box, Typography } from '@mui/material'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'

import type { NoteMeta } from '../../core'
import type { AssetLookup } from '../../assetLookup'
import { resolveAssetRef } from '../../assetLookup'
import { getFolderById, getRefsByFolderId, type FavoriteItemRef, type HyperCortexFavoritesDocV1 } from '../../favorites'
import { getAssetPreviewDescriptor } from '../assetPreview/registry'
import { EntityIcon } from '../entity-icon/EntityIcon'
import { folderTitle } from '../index-page/helpers'

/** 收藏夹预览面：只读展示该收藏夹的下一级条目列表（文件夹/笔记/附件）。 */
export function FolderPreviewSurface(props: {
  doc: HyperCortexFavoritesDocV1
  folderId: string
  noteIndex: Record<string, NoteMeta>
  assetLookup: AssetLookup
}): React.ReactNode {
  const { doc, folderId, noteIndex, assetLookup } = props
  const refs = React.useMemo(() => getRefsByFolderId(doc, folderId), [doc, folderId])

  const renderRow = (ref: FavoriteItemRef) => {
    if (ref.kind === 'folder') {
      const folder = getFolderById(doc, ref.targetId)
      if (!folder) return null
      return (
        <PreviewRow
          key={ref.id}
          icon={<EntityIcon icon={folder.icon} fallback={<FolderRoundedIcon fontSize="small" sx={{ color: 'var(--hc-primary)' }} />} targetKind="folder" targetRef={folder.id} size={18} />}
          title={folder.title || '未命名收藏夹'}
        />
      )
    }
    if (ref.kind === 'note') {
      const note = noteIndex[ref.targetId]
      if (!note) return null
      return (
        <PreviewRow
          key={ref.id}
          icon={<EntityIcon icon={note.icon} fallback={<NotesRoundedIcon fontSize="small" sx={{ color: 'var(--hc-text-subtle)' }} />} targetKind="note" targetRef={note.dir} size={18} />}
          title={note.title || '未命名'}
        />
      )
    }
    if (ref.kind === 'asset') {
      const asset = resolveAssetRef(assetLookup, ref.targetId)
      if (!asset) return null
      const preview = getAssetPreviewDescriptor(asset)
      const Icon = preview.icon
      const title = String(asset.displayName || asset.fileName || asset.assetId || '附件')
      const fallback = preview.kind !== 'unsupported'
        ? <Icon fontSize="small" sx={{ color: preview.color }} />
        : <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: 'var(--hc-asset-file)' }} />
      return <PreviewRow key={ref.id} icon={<EntityIcon icon={asset.icon} fallback={fallback} targetKind="asset" targetRef={asset.assetId} size={18} />} title={title} />
    }
    return null
  }

  const rows = refs.map(renderRow).filter(Boolean)

  return (
    <Box sx={{ width: '100%', px: 3, py: 2.5, boxSizing: 'border-box' }}>
      <Typography sx={{ mb: 0.5, fontSize: 22, lineHeight: 1.25, fontWeight: 900, color: 'var(--hc-text)' }}>
        {folderTitle(doc, folderId)}
      </Typography>
      <Typography sx={{ mb: 2, fontSize: 12, color: 'var(--hc-text-subtle)' }}>{rows.length} 个项目</Typography>
      {rows.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: 'var(--hc-text-muted)' }}>这个收藏夹还是空的</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {rows}
        </Box>
      )}
    </Box>
  )
}

function PreviewRow(props: { icon: React.ReactNode; title: string }): React.ReactNode {
  const { icon, title } = props
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.75, borderRadius: 2, bgcolor: 'var(--hc-surface-soft)' }}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{icon}</Box>
      <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--hc-text)' }}>{title}</Typography>
    </Box>
  )
}
