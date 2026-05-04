import * as React from 'react'
import { Box, Typography } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import VideoFileRoundedIcon from '@mui/icons-material/VideoFileRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import type { HyperCortexTabGroupV1, NoteMeta } from '../core'
import type { AssetEntry } from '../assetTypes'
import { pickAssetDisplayName } from '../assetDisplayName'
import { noteIdFromTabKey, tabKind } from '../tabKey'
import { parseSortableId } from './openTabsSortableModel'

type UseOpenTabsSortableOverlayParams = {
  activeId: string
  groupById: Record<string, HyperCortexTabGroupV1>
  noteById: Record<string, NoteMeta>
  noteByTabKey: Record<string, NoteMeta>
  assetByTabKey: Record<string, AssetEntry>
}

function SortableDragOverlayCard(props: { title: string; icon: React.ReactNode; groupColor?: string }) {
  const { title, icon, groupColor } = props
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        minWidth: 150,
        maxWidth: 220,
        px: 1,
        py: 0.6,
        borderRadius: 2,
        bgcolor: groupColor || '#fff',
        boxShadow: '0 14px 38px rgba(0,0,0,.22)',
        border: '1px solid rgba(0,0,0,.08)',
        pointerEvents: 'none',
      }}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{icon}</Box>
      <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.2, fontWeight: 900, color: 'rgba(0,0,0,.76)' }}>
        {title}
      </Typography>
    </Box>
  )
}

export function useOpenTabsSortableOverlay(params: UseOpenTabsSortableOverlayParams) {
  const { activeId, assetByTabKey, groupById, noteById, noteByTabKey } = params

  return React.useMemo(() => {
    const parsed = parseSortableId(activeId)
    if (!parsed) return null
    if (parsed.kind === 'group') {
      const group = groupById[parsed.groupId]
      if (!group) return null
      return (
        <SortableDragOverlayCard
          title={group.title || '分组'}
          groupColor={group.color}
          icon={<ChevronRightRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.42)' }} />}
        />
      )
    }

    const kind = tabKind(parsed.tabKey)
    if (kind === 'note') {
      const nid = noteIdFromTabKey(parsed.tabKey)
      const meta = (nid && noteById[nid]) || noteByTabKey[parsed.tabKey]
      return <SortableDragOverlayCard title={meta?.title || '已丢失的笔记'} icon={<NotesRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.48)' }} />} />
    }

    const asset = assetByTabKey[parsed.tabKey]
    const title = asset ? pickAssetDisplayName({ indexName: asset.displayName, ext: asset.ext }) || '附件' : '已丢失的附件'
    const icon = asset?.kind === 'image'
      ? <ImageRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.48)' }} />
      : asset?.kind === 'video'
        ? <VideoFileRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.48)' }} />
        : <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.48)' }} />
    return <SortableDragOverlayCard title={title} icon={icon} />
  }, [activeId, assetByTabKey, groupById, noteById, noteByTabKey])
}
