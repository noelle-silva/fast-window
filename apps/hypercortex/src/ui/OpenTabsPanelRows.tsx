import * as React from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import NotesRoundedIcon from '@mui/icons-material/NotesRounded'
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded'
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import type { NoteMeta } from '../core'
import type { AssetEntry } from '../assetTypes'
import { assetRefKey } from '../assetTypes'
import { pickAssetDisplayName } from '../assetDisplayName'
import { noteIdFromTabKey, tabKind } from '../tabKey'
import { EntityIcon } from './entity-icon/EntityIcon'
import { getAssetPreviewDescriptor } from './assetPreview/registry'
import { SIDEBAR_ROW_HEIGHT } from './sidebarLayout'
import { SortableDropSlot, SortableItem, type SortableItemRenderArgs } from './SortableDnd'
import { sortableTabId } from './openTabsSortableModel'
import { useOpenTabsPointerDnd } from './useOpenTabsPointerDnd'
import { useOpenTabsSortableDnd } from './useOpenTabsSortableDnd'

export type OpenTabsPanelRowOpts = {
  topIndex?: number
  parentGroupId?: string
  groupTabIndex?: number
  sortable?: SortableItemRenderArgs
}

export type OpenTabsPanelSortableRowOpts = {
  topIndex?: number
  parentGroupId?: string
  groupTabIndex?: number
  itemKey?: string
}

export type OpenTabsPanelRowsParams = {
  activeTabKey?: string
  tabSelectionVisible: boolean
  tabsMode: 'manual' | 'hover'
  showTitle: boolean
  activeTabRowRef: React.MutableRefObject<HTMLElement | null>
  sortableActiveId: string
  playingTabKeys?: ReadonlySet<string>
  isNoteDirty?: (noteId: string) => boolean
  onOpenTab: (tab: NoteMeta) => void
  onCloseTab: (noteId: string) => void
  onOpenAssetTab?: (asset: AssetEntry) => void
  onCloseAssetTab?: (tabKey: string) => void
  /** 笔记/附件条目右键：接入与收藏夹侧栏同源的实体操作菜单。 */
  onNoteContextMenu?: (event: React.MouseEvent, note: NoteMeta) => void
  onAssetContextMenu?: (event: React.MouseEvent, asset: AssetEntry) => void
  noteById: Record<string, NoteMeta>
  noteByTabKey: Record<string, NoteMeta>
  assetByTabKey: Record<string, AssetEntry>
  dnd: ReturnType<typeof useOpenTabsPointerDnd>
  sortableDnd: ReturnType<typeof useOpenTabsSortableDnd>
}

function DndInsertCursor(props: { pos: 'before' | 'after'; color?: string }) {
  const { pos, color } = props
  const top = pos === 'before' ? 0 : 'auto'
  const bottom = pos === 'after' ? 0 : 'auto'
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        left: 10,
        right: 8,
        top,
        bottom,
        height: 2,
        borderRadius: 999,
        bgcolor: color || 'var(--hc-primary)',
        boxShadow: '0 0 0 2px rgba(255,255,255,.92)',
        pointerEvents: 'none',
      }}
    />
  )
}

export function TopLevelDropSlot(props: { index: number; active: boolean }) {
  const { index, active } = props
  return (
    <Box
      data-hc-dnd-top-slot-index={index}
      aria-hidden
      sx={{
        position: 'relative',
        height: 3,
        mx: 0.5,
        borderRadius: 999,
        bgcolor: active ? 'var(--hc-primary-soft)' : 'transparent',
        transition: 'background-color 120ms ease',
        '&::before': active
          ? {
              content: '""',
              position: 'absolute',
              left: 8,
              right: 8,
              top: 0.5,
              height: 2,
              borderRadius: 999,
              bgcolor: 'var(--hc-primary)',
              boxShadow: '0 0 0 2px var(--hc-surface)',
            }
          : undefined,
      }}
    />
  )
}

export function GroupDropSlot(props: { groupId: string; index: number; active: boolean; showTitle: boolean }) {
  const { groupId, index, active, showTitle } = props
  return (
    <Box
      data-hc-dnd-group-slot-id={groupId}
      data-hc-dnd-group-slot-index={index}
      aria-hidden
      sx={{
        position: 'relative',
        height: 3,
        ml: showTitle ? 1.5 : 1,
        mr: 0.5,
        borderRadius: 999,
        bgcolor: active ? 'var(--hc-primary-soft)' : 'transparent',
        transition: 'background-color 120ms ease',
        '&::before': active
          ? {
              content: '""',
              position: 'absolute',
              left: 8,
              right: 8,
              top: 0.5,
              height: 2,
              borderRadius: 999,
              bgcolor: 'var(--hc-primary)',
              boxShadow: '0 0 0 2px var(--hc-surface)',
            }
          : undefined,
      }}
    />
  )
}

export function SortableInsertionSlot(props: { id: string; enabled: boolean; indent?: boolean; showTitle: boolean }) {
  const { id, enabled, indent = false, showTitle } = props
  return (
    <SortableDropSlot id={id} disabled={!enabled}>
      {slot => {
        const active = enabled && slot.isOver
        return (
          <Box
            ref={slot.setNodeRef}
            aria-hidden
            sx={{
              position: 'relative',
              height: active ? 12 : 4,
              ml: indent ? (showTitle ? 1.5 : 1) : 0.5,
              mr: 0.5,
              borderRadius: 999,
              bgcolor: active ? 'var(--hc-primary-soft)' : 'transparent',
              transition: 'background-color 120ms ease, height 120ms ease',
              '&::before': active
                ? {
                    content: '""',
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    top: '50%',
                    height: 2,
                    borderRadius: 999,
                    bgcolor: 'var(--hc-primary)',
                    boxShadow: '0 0 0 2px var(--hc-surface)',
                    transform: 'translateY(-50%)',
                  }
                : undefined,
            }}
          />
        )
      }}
    </SortableDropSlot>
  )
}

function getSortableTabRowProps(args?: SortableItemRenderArgs, label?: string, activeRef?: React.MutableRefObject<HTMLElement | null>) {
  if (!args) return {}
  return {
    ref: (node: HTMLElement | null) => {
      if (activeRef) activeRef.current = node
      args.setNodeRef(node)
      args.setHandleRef(node)
    },
    'aria-label': label,
    ...args.handleProps,
  }
}

export function getSortableRowHandleProps(args?: SortableItemRenderArgs, label?: string) {
  if (!args) return {}
  return {
    ref: args.setHandleRef as any,
    'aria-label': label,
    ...args.handleProps,
  }
}

export function SortableIconSlot(props: { children: React.ReactNode }) {
  const { children } = props
  return (
    <Box
      sx={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
      }}
    >
      {children}
    </Box>
  )
}

export function useOpenTabsPanelRows(params: OpenTabsPanelRowsParams) {
  const {
    activeTabKey,
    tabSelectionVisible,
    tabsMode,
    showTitle,
    activeTabRowRef,
    sortableActiveId,
    playingTabKeys,
    isNoteDirty,
    onOpenTab,
    onCloseTab,
    onOpenAssetTab,
    onCloseAssetTab,
    onNoteContextMenu,
    onAssetContextMenu,
    noteById,
    noteByTabKey,
    assetByTabKey,
    dnd,
    sortableDnd,
  } = params

  const renderNoteMetaRow = React.useCallback(
    (tabKey: string, tab: NoteMeta, opts?: OpenTabsPanelRowOpts) => {
      const isActive = !!tabSelectionVisible && String(activeTabKey || '').trim() === tabKey
      const title = tab.title || '未命名'
      const dirty = !!isNoteDirty?.(tab.id)
      const isDragOver = dnd.dragOverKey === `tab_${tabKey}`
      const isDragging = opts?.sortable?.isDragging || dnd.draggingKey === `tab_${tabKey}`
      const isSortablePlaceholder = !!opts?.sortable && sortableActiveId === sortableTabId(tabKey)
      const disableTitleTooltip = tabsMode === 'hover'
      const isPlaying = !!playingTabKeys?.has(tabKey)
      return (
        <Tooltip
          key={tabKey}
          title={!showTitle && !disableTitleTooltip ? title : ''}
          placement="right"
          disableHoverListener={showTitle || disableTitleTooltip}
          disableFocusListener={disableTitleTooltip}
          disableTouchListener={disableTitleTooltip}
            >
            <Box
              ref={isActive ? activeTabRowRef : undefined}
              {...dnd.getTabProps(tabKey)}
              {...getSortableTabRowProps(opts?.sortable, `拖拽排序 ${title}`, isActive ? activeTabRowRef : undefined)}
            data-hc-preview-entry={`note:${tab.id}`}
            data-hc-dnd-top-index={typeof opts?.topIndex === 'number' ? opts.topIndex : undefined}
            data-hc-dnd-parent-group-id={opts?.parentGroupId || undefined}
            data-hc-dnd-group-tab-index={typeof opts?.groupTabIndex === 'number' ? opts.groupTabIndex : undefined}
            onContextMenu={onNoteContextMenu ? e => onNoteContextMenu(e, tab) : undefined}
            role="button"
            tabIndex={0}
              style={opts?.sortable?.style}
            onClick={() => {
              if (dnd.suppressClickRef.current) return
              onOpenTab(tab)
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onOpenTab(tab)
            }}
            sx={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: showTitle ? 1 : 0.75,
              minHeight: showTitle ? SIDEBAR_ROW_HEIGHT : undefined,
              py: 0.6,
              boxSizing: 'border-box',
              borderRadius: 2,
              userSelect: 'none',
              outline: 'none',
              cursor: isDragging ? 'grabbing' : opts?.sortable ? 'grab' : 'pointer',
              touchAction: opts?.sortable ? 'none' : undefined,
              opacity: isSortablePlaceholder ? 0.44 : isDragging ? 0.72 : 1,
              boxShadow: isSortablePlaceholder ? '0 10px 24px var(--hc-shadow)' : 'none',
              bgcolor: isSortablePlaceholder ? 'var(--hc-primary-soft)' : isDragOver ? 'var(--hc-primary-soft)' : isActive ? 'var(--hc-primary-soft)' : 'transparent',
              '&:hover': { bgcolor: isSortablePlaceholder ? 'var(--hc-primary-soft)' : isDragOver ? 'var(--hc-primary-hover)' : isActive ? 'var(--hc-primary-hover)' : 'var(--hc-surface-soft)' },
              '&:focus-visible': { boxShadow: '0 10px 24px var(--hc-shadow)' },
            }}
          >
            <SortableIconSlot>
              {isPlaying ? (
                <VolumeUpRoundedIcon fontSize="small" sx={{ color: 'var(--hc-success)' }} />
              ) : (
                <EntityIcon
                  icon={tab.icon}
                  fallback={<NotesRoundedIcon fontSize="small" sx={{ color: isActive ? 'var(--hc-primary)' : 'var(--hc-text-subtle)' }} />}
                  targetKind="note"
                  targetRef={tab.dir}
                  size={18}
                />
              )}
              {dirty ? (
                <Box
                  aria-label="未保存改动"
                  sx={{
                    position: 'absolute',
                    left: -1,
                    top: -1,
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    bgcolor: 'var(--hc-accent-butter)',
                    boxShadow: '0 0 0 2px var(--hc-surface)',
                  }}
                />
              ) : null}
            </SortableIconSlot>
            {showTitle ? (
              <Typography
                noWrap
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.2,
                  fontWeight: isActive ? 900 : 600,
                  color: isActive ? 'var(--hc-text)' : 'var(--hc-text-muted)',
                }}
              >
                {title}
              </Typography>
            ) : null}
            {showTitle ? (
              <Tooltip title="关闭" placement="left">
                <IconButton
                  size="small"
                  aria-label={`关闭 ${title}`}
                  data-hc-no-drag="1"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  sx={{
                    color: 'rgba(0,0,0,.42)',
                    '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
                  }}
                >
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        </Tooltip>
      )
    },
    [activeTabKey, dnd, isNoteDirty, onCloseTab, onNoteContextMenu, onOpenTab, playingTabKeys, showTitle, sortableActiveId, tabSelectionVisible, tabsMode],
  )

  const renderAssetMetaRow = React.useCallback(
    (tabKey: string, asset: AssetEntry, opts?: OpenTabsPanelRowOpts) => {
      const isActive = !!tabSelectionVisible && String(activeTabKey || '').trim() === tabKey
      const title = pickAssetDisplayName({ indexName: asset.displayName, ext: asset.ext }) || '附件'
      const isDragOver = dnd.dragOverKey === `tab_${tabKey}`
      const isDragging = opts?.sortable?.isDragging || dnd.draggingKey === `tab_${tabKey}`
      const isSortablePlaceholder = !!opts?.sortable && sortableActiveId === sortableTabId(tabKey)
      const disableTitleTooltip = tabsMode === 'hover'
      const isPlaying = !!playingTabKeys?.has(tabKey)
      const preview = getAssetPreviewDescriptor(asset)
      const PreviewIcon = preview.icon
      const fallbackIcon =
        preview.kind !== 'unsupported' ? (
          <PreviewIcon fontSize="small" sx={{ color: isActive ? preview.color : 'var(--hc-text-subtle)' }} />
        ) : (
          <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: isActive ? 'var(--hc-asset-file)' : 'var(--hc-text-subtle)' }} />
        )
      const iconEl = isPlaying ? (
        <VolumeUpRoundedIcon fontSize="small" sx={{ color: 'var(--hc-success)' }} />
      ) : (
        <EntityIcon icon={asset.icon} fallback={fallbackIcon} targetKind="asset" targetRef={asset.assetId} size={18} />
      )

      return (
        <Tooltip
          key={tabKey}
          title={!showTitle && !disableTitleTooltip ? title : ''}
          placement="right"
          disableHoverListener={showTitle || disableTitleTooltip}
          disableFocusListener={disableTitleTooltip}
          disableTouchListener={disableTitleTooltip}
            >
            <Box
              ref={isActive ? activeTabRowRef : undefined}
              {...dnd.getTabProps(tabKey)}
              {...getSortableTabRowProps(opts?.sortable, `拖拽排序 ${title}`, isActive ? activeTabRowRef : undefined)}
            data-hc-preview-entry={`asset:${assetRefKey(asset)}`}
            data-hc-dnd-top-index={typeof opts?.topIndex === 'number' ? opts.topIndex : undefined}
            data-hc-dnd-parent-group-id={opts?.parentGroupId || undefined}
            data-hc-dnd-group-tab-index={typeof opts?.groupTabIndex === 'number' ? opts.groupTabIndex : undefined}
            onContextMenu={onAssetContextMenu ? e => onAssetContextMenu(e, asset) : undefined}
            role="button"
            tabIndex={0}
              style={opts?.sortable?.style}
            onClick={() => {
              if (dnd.suppressClickRef.current) return
              onOpenAssetTab?.(asset)
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onOpenAssetTab?.(asset)
            }}
            sx={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: showTitle ? 1 : 0.75,
              minHeight: showTitle ? SIDEBAR_ROW_HEIGHT : undefined,
              py: 0.6,
              boxSizing: 'border-box',
              borderRadius: 2,
              userSelect: 'none',
              outline: 'none',
              cursor: isDragging ? 'grabbing' : opts?.sortable ? 'grab' : 'pointer',
              touchAction: opts?.sortable ? 'none' : undefined,
              opacity: isSortablePlaceholder ? 0.44 : isDragging ? 0.72 : 1,
              boxShadow: isSortablePlaceholder ? '0 10px 24px var(--hc-shadow)' : 'none',
              bgcolor: isSortablePlaceholder ? 'var(--hc-primary-soft)' : isDragOver ? 'var(--hc-primary-soft)' : isActive ? 'var(--hc-primary-soft)' : 'transparent',
              '&:hover': { bgcolor: isSortablePlaceholder ? 'var(--hc-primary-soft)' : isDragOver ? 'var(--hc-primary-hover)' : isActive ? 'var(--hc-primary-hover)' : 'var(--hc-surface-soft)' },
              '&:focus-visible': { boxShadow: '0 10px 24px var(--hc-shadow)' },
            }}
          >
            <SortableIconSlot>{iconEl}</SortableIconSlot>
            {showTitle ? (
              <Typography
                noWrap
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.2,
                  fontWeight: isActive ? 900 : 600,
                  color: isActive ? 'var(--hc-text)' : 'var(--hc-text-muted)',
                }}
              >
                {title}
              </Typography>
            ) : null}
            {showTitle ? (
              <Tooltip title="关闭" placement="left">
                <IconButton
                  size="small"
                  aria-label={`关闭 ${title}`}
                  data-hc-no-drag="1"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.stopPropagation()
                    onCloseAssetTab?.(tabKey)
                  }}
                  sx={{
                    color: 'rgba(0,0,0,.42)',
                    '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
                  }}
                >
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        </Tooltip>
      )
    },
    [activeTabKey, dnd, onAssetContextMenu, onCloseAssetTab, onOpenAssetTab, playingTabKeys, showTitle, sortableActiveId, tabSelectionVisible, tabsMode],
  )

  const renderMissingRow = React.useCallback(
    (tabKey: string, kind: 'note' | 'asset', opts?: OpenTabsPanelRowOpts) => {
      const isActive = !!tabSelectionVisible && String(activeTabKey || '').trim() === tabKey
      const title = kind === 'note' ? '已丢失的笔记' : '已丢失的附件'
      const isDragOver = dnd.dragOverKey === `tab_${tabKey}`
      const isDragging = opts?.sortable?.isDragging || dnd.draggingKey === `tab_${tabKey}`
      const isSortablePlaceholder = !!opts?.sortable && sortableActiveId === sortableTabId(tabKey)
      const disableTitleTooltip = tabsMode === 'hover'
      const iconEl =
        kind === 'note' ? (
          <NotesRoundedIcon fontSize="small" sx={{ color: isActive ? 'var(--hc-primary)' : 'var(--hc-text-subtle)' }} />
        ) : (
          <InsertDriveFileRoundedIcon fontSize="small" sx={{ color: isActive ? 'var(--hc-asset-file)' : 'var(--hc-text-subtle)' }} />
        )

      return (
        <Tooltip
          key={tabKey}
          title={!showTitle && !disableTitleTooltip ? title : ''}
          placement="right"
          disableHoverListener={showTitle || disableTitleTooltip}
          disableFocusListener={disableTitleTooltip}
          disableTouchListener={disableTitleTooltip}
            >
            <Box
              ref={isActive ? activeTabRowRef : undefined}
              {...dnd.getTabProps(tabKey)}
              {...getSortableTabRowProps(opts?.sortable, `拖拽排序 ${title}`, isActive ? activeTabRowRef : undefined)}
            data-hc-dnd-top-index={typeof opts?.topIndex === 'number' ? opts.topIndex : undefined}
            data-hc-dnd-parent-group-id={opts?.parentGroupId || undefined}
            data-hc-dnd-group-tab-index={typeof opts?.groupTabIndex === 'number' ? opts.groupTabIndex : undefined}
            role="button"
            tabIndex={0}
              style={opts?.sortable?.style}
            onClick={() => {
              if (dnd.suppressClickRef.current) return
              if (kind === 'note') return
              return
            }}
            sx={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: showTitle ? 1 : 0.75,
              minHeight: showTitle ? SIDEBAR_ROW_HEIGHT : undefined,
              py: 0.6,
              boxSizing: 'border-box',
              borderRadius: 2,
              userSelect: 'none',
              outline: 'none',
              cursor: isDragging ? 'grabbing' : opts?.sortable ? 'grab' : 'pointer',
              touchAction: opts?.sortable ? 'none' : undefined,
              opacity: isSortablePlaceholder ? 0.44 : isDragging ? 0.72 : 0.86,
              boxShadow: isSortablePlaceholder ? '0 10px 24px var(--hc-shadow)' : 'none',
              bgcolor: isSortablePlaceholder ? 'var(--hc-primary-soft)' : isDragOver ? 'var(--hc-primary-soft)' : isActive ? 'var(--hc-primary-soft)' : 'transparent',
              '&:hover': { bgcolor: isSortablePlaceholder ? 'var(--hc-primary-soft)' : isDragOver ? 'var(--hc-primary-hover)' : isActive ? 'var(--hc-primary-hover)' : 'var(--hc-surface-soft)' },
              '&:focus-visible': { boxShadow: '0 10px 24px var(--hc-shadow)' },
            }}
          >
            <SortableIconSlot>{iconEl}</SortableIconSlot>
            {showTitle ? (
              <Typography
                noWrap
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.2,
                  fontWeight: isActive ? 900 : 600,
                  color: 'rgba(0,0,0,.55)',
                }}
              >
                {title}
              </Typography>
            ) : null}
            {showTitle ? (
              <Tooltip title="关闭" placement="left">
                <IconButton
                  size="small"
                  aria-label={`关闭 ${title}`}
                  data-hc-no-drag="1"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.stopPropagation()
                    if (kind === 'note') onCloseTab(noteIdFromTabKey(tabKey))
                    else onCloseAssetTab?.(tabKey)
                  }}
                  sx={{
                    color: 'rgba(0,0,0,.42)',
                    '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
                  }}
                >
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        </Tooltip>
      )
    },
    [activeTabKey, dnd, noteIdFromTabKey, onCloseAssetTab, onCloseTab, showTitle, sortableActiveId, tabSelectionVisible, tabsMode],
  )

  const renderTabKeyRow = React.useCallback(
    (tabKey: string, opts?: OpenTabsPanelRowOpts) => {
      const kind = tabKind(tabKey)
      if (kind === 'note') {
        const nid = noteIdFromTabKey(tabKey)
        const meta = (nid && noteById[nid]) || noteByTabKey[tabKey]
        if (!meta) return renderMissingRow(tabKey, 'note', opts)
        return renderNoteMetaRow(tabKey, meta, opts)
      }
      if (kind === 'asset') {
        const asset = assetByTabKey[tabKey]
        if (!asset) return renderMissingRow(tabKey, 'asset', opts)
        return renderAssetMetaRow(tabKey, asset, opts)
      }
      return null
    },
    [assetByTabKey, noteById, noteByTabKey, renderAssetMetaRow, renderMissingRow, renderNoteMetaRow],
  )

  const renderSortableTabKeyRow = React.useCallback(
    (tabKey: string, opts?: OpenTabsPanelSortableRowOpts) => {
      const id = sortableTabId(tabKey)
      return (
        <SortableItem key={opts?.itemKey || tabKey} id={id} disableTransform={sortableDnd.shouldDisableItemTransform(id)}>
          {sortable => renderTabKeyRow(tabKey, { ...opts, sortable })}
        </SortableItem>
      )
    },
    [renderTabKeyRow, sortableDnd],
  )

  return { renderNoteMetaRow, renderAssetMetaRow, renderMissingRow, renderTabKeyRow, renderSortableTabKeyRow }
}
