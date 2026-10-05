import * as React from 'react'
import { Box, Typography } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import type { HyperCortexTabGroupV1 } from '../core'
import type { SortableItemRenderArgs } from './SortableDnd'
import { SortableSection } from './SortableDnd'
import { sortableGroupId, sortableGroupSlotId, sortableTabId } from './openTabsSortableModel'
import { useOpenTabsPointerDnd } from './useOpenTabsPointerDnd'
import {
  GroupDropSlot,
  SortableIconSlot,
  SortableInsertionSlot,
  getSortableRowHandleProps,
  type OpenTabsPanelRowOpts,
  type OpenTabsPanelSortableRowOpts,
} from './OpenTabsPanelRows'

export type OpenTabsPanelGroupSectionParams = {
  showTitle: boolean
  dnd: ReturnType<typeof useOpenTabsPointerDnd>
  sortableActiveId: string
  canDropSortableTab: boolean
  renderTabKeyRow: (tabKey: string, opts?: OpenTabsPanelRowOpts) => React.ReactNode
  renderSortableTabKeyRow: (tabKey: string, opts?: OpenTabsPanelSortableRowOpts) => React.ReactNode
  onToggleGroupCollapsed: (groupId: string) => void
  setGroupMenu: (state: { mouseX: number; mouseY: number; groupId: string }) => void
}

export function useOpenTabsPanelGroupSection(params: OpenTabsPanelGroupSectionParams) {
  const {
    showTitle,
    dnd,
    sortableActiveId,
    canDropSortableTab,
    renderTabKeyRow,
    renderSortableTabKeyRow,
    onToggleGroupCollapsed,
    setGroupMenu,
  } = params

  return React.useCallback(
    (params: { group: HyperCortexTabGroupV1; itemIndex: number; list: string[]; isCollapsed: boolean; sortable?: SortableItemRenderArgs; sortableTabs: boolean }) => {
      const { group: g, itemIndex, list, isCollapsed, sortable, sortableTabs } = params
      const isDragOver = dnd.dragOverKey === `group_${g.id}`
      const isDragging = sortable?.isDragging || dnd.draggingKey === `group_${g.id}`
      const isSortablePlaceholder = !!sortable && sortableActiveId === sortableGroupId(g.id)
      const groupTitle = g.title || '分组'

      const tabList = isCollapsed ? null : list.length || sortableTabs ? (
        <Box
          sx={{
            position: 'relative',
            pl: showTitle ? 1 : 0.75,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.25,
            py: 0.25,
            '&::before': {
              content: '""',
              position: 'absolute',
              left: 0,
              top: 2,
              bottom: 2,
              width: 3,
              borderRadius: 2,
              bgcolor: g.color,
            },
          }}
        >
          {sortableTabs ? null : <GroupDropSlot groupId={g.id} index={0} active={dnd.dropIndicator.kind === 'group-slot' && dnd.dropIndicator.groupId === g.id && dnd.dropIndicator.index === 0} showTitle={showTitle} />}
          {sortableTabs ? (
            <SortableSection items={list.map(sortableTabId)}>
              <SortableInsertionSlot id={sortableGroupSlotId(g.id, 0)} enabled={canDropSortableTab} indent showTitle={showTitle} />
              {list.map((tabKey, groupTabIndex) => (
                <React.Fragment key={`${g.id}_${tabKey}`}>
                  {renderSortableTabKeyRow(tabKey, { topIndex: itemIndex, parentGroupId: g.id, groupTabIndex, itemKey: `${g.id}_${tabKey}` })}
                  <SortableInsertionSlot id={sortableGroupSlotId(g.id, groupTabIndex + 1)} enabled={canDropSortableTab} indent showTitle={showTitle} />
                </React.Fragment>
              ))}
            </SortableSection>
          ) : (
            list.map((tabKey, groupTabIndex) => (
              <React.Fragment key={tabKey}>
                {renderTabKeyRow(tabKey, { topIndex: itemIndex, parentGroupId: g.id, groupTabIndex })}
                <GroupDropSlot
                  groupId={g.id}
                  index={groupTabIndex + 1}
                  active={dnd.dropIndicator.kind === 'group-slot' && dnd.dropIndicator.groupId === g.id && dnd.dropIndicator.index === groupTabIndex + 1}
                  showTitle={showTitle}
                />
              </React.Fragment>
            ))
          )}
        </Box>
      ) : sortableTabs ? null : (
        <GroupDropSlot groupId={g.id} index={0} active={dnd.dropIndicator.kind === 'group-slot' && dnd.dropIndicator.groupId === g.id && dnd.dropIndicator.index === 0} showTitle={showTitle} />
      )

      return (
        <Box ref={sortable?.setNodeRef as any} style={sortable?.style} sx={{ position: 'relative' }}>
          <Box
            {...dnd.getGroupProps(g.id)}
            {...getSortableRowHandleProps(sortable, `拖拽排序分组 ${groupTitle}`)}
            data-hc-dnd-group-index={itemIndex}
            data-hc-dnd-group-section-index={itemIndex}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (dnd.suppressClickRef.current) return
              onToggleGroupCollapsed(g.id)
            }}
            onKeyDown={e => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onToggleGroupCollapsed(g.id)
            }}
            onContextMenu={e => {
              e.preventDefault()
              setGroupMenu({ mouseX: e.clientX, mouseY: e.clientY, groupId: g.id })
            }}
            sx={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: showTitle ? 1 : 0.75,
              py: 0.5,
              borderRadius: 2,
              userSelect: 'none',
              outline: 'none',
              cursor: isDragging ? 'grabbing' : sortable ? 'grab' : 'pointer',
              touchAction: sortable ? 'none' : undefined,
              opacity: isSortablePlaceholder ? 0.5 : isDragging ? 0.78 : 1,
              boxShadow: isSortablePlaceholder ? '0 10px 24px var(--hc-shadow)' : 'none',
              backgroundImage: 'none',
              bgcolor: isSortablePlaceholder || isDragOver ? 'var(--hc-primary-soft)' : g.color,
              '&:hover': { filter: 'brightness(0.985)' },
              '&:focus-visible': { bgcolor: 'var(--hc-primary-soft)', boxShadow: '0 10px 24px var(--hc-shadow)' },
            }}
          >
            <SortableIconSlot>
              <ChevronRightRoundedIcon
                fontSize="small"
                sx={{ color: 'rgba(0,0,0,.42)', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 120ms ease' }}
              />
            </SortableIconSlot>
            {showTitle ? (
              <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.72)' }}>
                {groupTitle}
              </Typography>
            ) : null}
            {showTitle ? <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)' }}>{list.length}</Typography> : null}
          </Box>
          {tabList}
        </Box>
      )
    },
    [canDropSortableTab, dnd, onToggleGroupCollapsed, renderSortableTabKeyRow, renderTabKeyRow, setGroupMenu, showTitle, sortableActiveId],
  )
}
