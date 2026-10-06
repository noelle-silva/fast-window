import * as React from 'react'
import { Box, Typography } from '@mui/material'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import type { NoteMeta } from '../core'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import type { AssetEntry } from '../assetTypes'
import type { AssetLookup } from '../assetLookup'
import { resolveAssetRef } from '../assetLookup'
import { getAssetPreviewDescriptor } from './assetPreview/registry'
import { folderTitle } from './index-page/helpers'

export function assetRowTitle(asset: AssetEntry): string {
  return String(asset.displayName || asset.fileName || asset.assetId || '附件')
}

type UseFavoritesSidebarOverlayParams = {
  activeId: string
  refs: FavoriteItemRef[]
  doc: HyperCortexFavoritesDocV1 | null
  noteIndex?: Record<string, NoteMeta>
  assetLookup: AssetLookup
}

/** 收藏夹条目拖影呈现：按激活条目解析标题与图标，浮层跟手。 */
export function useFavoritesSidebarOverlay(params: UseFavoritesSidebarOverlayParams): React.ReactNode {
  const { activeId, refs, doc, noteIndex, assetLookup } = params

  const dragOverlayRef = React.useMemo(() => (activeId ? refs.find(ref => ref.id === activeId) ?? null : null), [activeId, refs])

  const dragOverlayTitle = React.useMemo(() => {
    if (!dragOverlayRef) return ''
    if (dragOverlayRef.kind === 'folder') return doc ? folderTitle(doc, dragOverlayRef.targetId) : '收藏夹'
    if (dragOverlayRef.kind === 'note') return noteIndex?.[dragOverlayRef.targetId]?.title || '已丢失的笔记'
    if (dragOverlayRef.kind === 'asset') {
      const asset = resolveAssetRef(assetLookup, dragOverlayRef.targetId)
      return asset ? assetRowTitle(asset) : '已丢失的附件'
    }
    return '已丢失的条目'
  }, [assetLookup, doc, dragOverlayRef, noteIndex])

  const dragOverlayIcon = React.useMemo(() => {
    if (!dragOverlayRef) return null
    if (dragOverlayRef.kind === 'folder') return <FolderRoundedIcon fontSize="small" sx={{ color: 'var(--hc-primary)' }} />
    if (dragOverlayRef.kind === 'note') return <NotesRoundedIcon fontSize="small" sx={{ color: 'var(--hc-text-subtle)' }} />
    if (dragOverlayRef.kind === 'asset') {
      const asset = resolveAssetRef(assetLookup, dragOverlayRef.targetId)
      if (asset) {
        const preview = getAssetPreviewDescriptor(asset)
        const PreviewIcon = preview.icon
        if (preview.kind !== 'unsupported') return <PreviewIcon fontSize="small" sx={{ color: preview.color }} />
      }
    }
    return <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: 'var(--hc-text-subtle)' }} />
  }, [assetLookup, dragOverlayRef])

  // 本栏只为自己名下的条目呈现浮层；跨栏外来条目由来源侧浮层跟手，此处不重复呈现。
  if (!activeId || !dragOverlayRef) return null
  return <FavoritesDragOverlayCard title={dragOverlayTitle} icon={dragOverlayIcon} />
}

function FavoritesDragOverlayCard(props: { title: string; icon: React.ReactNode }): React.ReactNode {
  const { title, icon } = props
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        width: '100%',
        boxSizing: 'border-box',
        px: 1,
        py: 0.6,
        borderRadius: 2,
        bgcolor: 'var(--hc-surface)',
        boxShadow: '0 14px 38px rgba(0,0,0,.22)',
        pointerEvents: 'none',
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{icon}</Box>
      <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.2, fontWeight: 800, color: 'var(--hc-text)' }}>
        {title}
      </Typography>
    </Box>
  )
}
