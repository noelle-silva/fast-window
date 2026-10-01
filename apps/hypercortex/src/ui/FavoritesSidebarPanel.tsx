import * as React from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded'
import type { HyperCortexFavoritesNavV1, NoteMeta } from '../core'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { getFolderById, getRefsByFolderId } from '../favorites'
import type { AssetEntry } from '../assetTypes'
import { buildAssetLookup, resolveAssetRef } from '../assetLookup'
import { getAssetPreviewDescriptor } from './assetPreview/registry'
import { folderTitle } from './index-page/helpers'

export type FavoritesSidebarPanelProps = {
  panelWidth: number
  mode: 'manual' | 'hover'
  collapsed: boolean
  doc: HyperCortexFavoritesDocV1 | null
  nav: HyperCortexFavoritesNavV1
  noteIndex?: Record<string, NoteMeta>
  assetIndex?: Record<string, any>
  onNavigate: (folderId: string) => void
  onBack: () => void
  onForward: () => void
  onToggleCollapsed: () => void
  onToggleMode: () => void
  onOpenNote: (note: NoteMeta) => void
  onOpenAsset: (asset: AssetEntry) => void
}

function assetRowTitle(asset: AssetEntry): string {
  return String(asset.displayName || asset.fileName || asset.assetId || '附件')
}

export function FavoritesSidebarPanel(props: FavoritesSidebarPanelProps): React.ReactNode {
  const {
    panelWidth,
    mode,
    collapsed,
    doc,
    nav,
    noteIndex,
    assetIndex,
    onNavigate,
    onBack,
    onForward,
    onToggleCollapsed,
    onToggleMode,
    onOpenNote,
    onOpenAsset,
  } = props

  const showTitle = panelWidth > 52
  const disableTooltips = mode === 'hover'
  const canGoBack = nav.back.length > 0
  const canGoForward = nav.forward.length > 0
  const currentTitle = doc ? folderTitle(doc, nav.currentFolderId) : '收藏夹'
  const assetLookup = React.useMemo(() => buildAssetLookup(assetIndex), [assetIndex])
  const refs = React.useMemo(() => (doc ? getRefsByFolderId(doc, nav.currentFolderId) : []), [doc, nav.currentFolderId])

  const renderFolderRow = (ref: FavoriteItemRef): React.ReactNode => {
    const folder = doc ? getFolderById(doc, ref.targetId) : undefined
    if (!folder) return renderMissingRow(ref)
    const title = folder.title || '未命名收藏夹'
    return (
      <RowShell key={ref.id} showTitle={showTitle} title={title} tooltipDisabled={disableTooltips} onClick={() => onNavigate(folder.id)}>
        <FolderRoundedIcon fontSize="small" sx={{ color: 'var(--hc-primary)' }} />
        {showTitle ? <RowLabel title={title} /> : null}
        {showTitle ? <ChevronRightRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.32)', flexShrink: 0 }} /> : null}
      </RowShell>
    )
  }

  const renderNoteRow = (ref: FavoriteItemRef): React.ReactNode => {
    const note = noteIndex?.[ref.targetId]
    if (!note) return renderMissingRow(ref)
    const title = note.title || '未命名'
    return (
      <RowShell key={ref.id} showTitle={showTitle} title={title} tooltipDisabled={disableTooltips} onClick={() => onOpenNote(note)}>
        <NotesRoundedIcon fontSize="small" sx={{ color: 'var(--hc-text-subtle)' }} />
        {showTitle ? <RowLabel title={title} /> : null}
      </RowShell>
    )
  }

  const renderAssetRow = (ref: FavoriteItemRef): React.ReactNode => {
    const asset = resolveAssetRef(assetLookup, ref.targetId)
    if (!asset) return renderMissingRow(ref)
    const title = assetRowTitle(asset)
    const preview = getAssetPreviewDescriptor(asset)
    const PreviewIcon = preview.icon
    return (
      <RowShell key={ref.id} showTitle={showTitle} title={title} tooltipDisabled={disableTooltips} onClick={() => onOpenAsset(asset)}>
        {preview.kind !== 'unsupported' ? (
          <PreviewIcon fontSize="small" sx={{ color: preview.color }} />
        ) : (
          <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: 'var(--hc-asset-file)' }} />
        )}
        {showTitle ? <RowLabel title={title} /> : null}
      </RowShell>
    )
  }

  const renderMissingRow = (ref: FavoriteItemRef): React.ReactNode => {
    const title = '已丢失的条目'
    return (
      <RowShell key={ref.id} showTitle={showTitle} title={title} tooltipDisabled={disableTooltips} muted onClick={() => {}}>
        <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: 'var(--hc-text-subtle)' }} />
        {showTitle ? <RowLabel title={title} /> : null}
      </RowShell>
    )
  }

  const renderRef = (ref: FavoriteItemRef): React.ReactNode => {
    if (ref.kind === 'folder') return renderFolderRow(ref)
    if (ref.kind === 'note') return renderNoteRow(ref)
    if (ref.kind === 'asset') return renderAssetRow(ref)
    return renderMissingRow(ref)
  }

  const renderModeToggle = (): React.ReactNode => (
    <Tooltip
      title={mode === 'manual' ? '切换到悬停展开（覆盖）' : '切换到手动展开（挤压）'}
      placement="left"
      disableHoverListener={disableTooltips}
      disableFocusListener={disableTooltips}
      disableTouchListener={disableTooltips}
    >
      <IconButton size="small" aria-label="切换收藏夹栏模式" onClick={onToggleMode} sx={{ color: 'rgba(0,0,0,.58)' }}>
        <SyncAltRoundedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )

  const renderCollapseToggle = (): React.ReactNode => (
    <Tooltip
      title={collapsed ? '展开收藏夹栏' : '收起收藏夹栏'}
      placement="left"
      disableHoverListener={disableTooltips}
      disableFocusListener={disableTooltips}
      disableTouchListener={disableTooltips}
    >
      <IconButton size="small" aria-label={collapsed ? '展开收藏夹栏' : '收起收藏夹栏'} onClick={onToggleCollapsed}>
        {collapsed ? <ChevronLeftRoundedIcon fontSize="small" /> : <ChevronRightRoundedIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  )

  return (
    <>
      <Box sx={{ px: 0.75, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.25 }}>
        {!showTitle ? (
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {mode === 'manual' ? renderCollapseToggle() : renderModeToggle()}
          </Box>
        ) : (
          <>
            <Tooltip title="后退" placement="left" disableHoverListener={disableTooltips} disableFocusListener={disableTooltips} disableTouchListener={disableTooltips}>
              <span>
                <IconButton size="small" aria-label="后退" disabled={!canGoBack} onClick={onBack}>
                  <ArrowBackRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="前进" placement="left" disableHoverListener={disableTooltips} disableFocusListener={disableTooltips} disableTouchListener={disableTooltips}>
              <span>
                <IconButton size="small" aria-label="前进" disabled={!canGoForward} onClick={onForward}>
                  <ArrowForwardRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Typography noWrap sx={{ flex: 1, minWidth: 0, px: 0.5, fontSize: 12, fontWeight: 800, color: 'var(--hc-text)' }}>
              {currentTitle}
            </Typography>
            {mode === 'manual' ? renderCollapseToggle() : null}
            {renderModeToggle()}
          </>
        )}
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { width: 0, height: 0 },
          px: 0.5,
          py: 0.75,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.25,
        }}
      >
        {!refs.length && showTitle ? (
          <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'rgba(0,0,0,.42)' }}>这个收藏夹还是空的</Typography>
        ) : null}
        {refs.map(renderRef)}
      </Box>
    </>
  )
}

function RowShell(props: {
  showTitle: boolean
  title: string
  tooltipDisabled: boolean
  muted?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.ReactNode {
  const { showTitle, title, tooltipDisabled, muted, onClick, children } = props
  return (
    <Tooltip
      title={!showTitle && !tooltipDisabled ? title : ''}
      placement="left"
      disableHoverListener={showTitle || tooltipDisabled}
      disableFocusListener={tooltipDisabled}
      disableTouchListener={tooltipDisabled}
    >
      <Box
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          onClick()
        }}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: showTitle ? 1 : 0.75,
          py: 0.6,
          borderRadius: 2,
          userSelect: 'none',
          outline: 'none',
          cursor: 'pointer',
          opacity: muted ? 0.86 : 1,
          '&:hover': { bgcolor: 'var(--hc-surface-soft)' },
          '&:focus-visible': { boxShadow: '0 10px 24px var(--hc-shadow)' },
        }}
      >
        {children}
      </Box>
    </Tooltip>
  )
}

function RowLabel(props: { title: string }): React.ReactNode {
  return (
    <Typography
      noWrap
      sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.2, fontWeight: 600, color: 'var(--hc-text-muted)' }}
    >
      {props.title}
    </Typography>
  )
}
