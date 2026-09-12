import * as React from 'react'
import DragIndicatorOutlinedIcon from '@mui/icons-material/DragIndicatorOutlined'
import { Box, List, ListItemButton, Typography } from '@mui/material'
import type { SpaceEntry } from '../executionSpace'
import { entryStatusDotClass, entryStatusLabel } from '../spaceEntryStatus'
import { SortableItem, SortableRoot, SortableSection } from './SortableDnd'

type SpaceRunSidebarProps = {
  entries: SpaceEntry[]
  repoNames?: ReadonlyMap<string, string>
  selectedRunId: string | null
  onSelect: (runId: string) => void
  onMove: (activeRunId: string, overRunId: string) => void
}

function startedAtTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

export function SpaceRunSidebar({ entries, repoNames, selectedRunId, onSelect, onMove }: SpaceRunSidebarProps) {
  const runIds = React.useMemo(() => entries.map(entry => entry.runId), [entries])

  if (entries.length === 0) {
    return (
      <Box className="cr-space-sidebar" component="nav" aria-label="运行实例列表">
        <Typography color="text.secondary" sx={{ padding: '12px 8px', fontSize: 12, textAlign: 'center' }}>
          暂无运行实例
        </Typography>
      </Box>
    )
  }

  return (
    <Box className="cr-space-sidebar" component="nav" aria-label="运行实例列表">
      <SortableRoot onMove={onMove}>
        <SortableSection items={runIds}>
          <List dense disablePadding>
            {entries.map(entry => {
              const selected = entry.runId === selectedRunId
              const time = startedAtTime(entry.startedAt)
              const repoName = repoNames?.get(entry.repoId) || ''
              const meta = [repoName, entryStatusLabel(entry), time].filter(Boolean).join(' · ')
              return (
                <SortableItem key={entry.runId} id={entry.runId}>
                  {(sortable) => (
                    <ListItemButton
                      ref={sortable.setNodeRef}
                      style={sortable.style}
                      selected={selected}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => {
                        if (!sortable.shouldSuppressClick()) onSelect(entry.runId)
                      }}
                      sx={{ gap: 1, alignItems: 'flex-start', borderRadius: '8px', px: 1, py: 0.75, mb: 0.5, opacity: sortable.isDragging ? 0.82 : 1 }}
                    >
                      <Box
                        component="span"
                        ref={sortable.setHandleRef}
                        aria-label="拖拽排序"
                        {...sortable.handleProps}
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          mt: '3px',
                          color: 'rgba(0, 0, 0, 0.32)',
                          cursor: sortable.isDragging ? 'grabbing' : 'grab',
                          touchAction: 'none',
                          '&:hover': { color: '#1976d2' },
                        }}
                      >
                        <DragIndicatorOutlinedIcon sx={{ fontSize: 16 }} />
                      </Box>
                      <Box className={entryStatusDotClass(entry)} sx={{ mt: '5px' }} aria-hidden="true" />
                      <Box sx={{ minWidth: 0, display: 'grid', gap: '2px' }}>
                        <Typography noWrap sx={{ fontSize: 13, fontWeight: 900 }}>
                          {entry.commandName || '未命名命令'}
                        </Typography>
                        <Typography noWrap color="text.secondary" sx={{ fontSize: 11 }}>
                          {meta}
                        </Typography>
                      </Box>
                    </ListItemButton>
                  )}
                </SortableItem>
              )
            })}
          </List>
        </SortableSection>
      </SortableRoot>
    </Box>
  )
}
