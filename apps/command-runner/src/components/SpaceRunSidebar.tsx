import * as React from 'react'
import { Box, List, ListItemButton, Typography } from '@mui/material'
import type { SpaceEntry } from '../executionSpace'
import { entryStatusDotClass, entryStatusLabel } from '../spaceEntryStatus'

type SpaceRunSidebarProps = {
  entries: SpaceEntry[]
  selectedRunId: string | null
  onSelect: (runId: string) => void
}

function startedAtTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

export function SpaceRunSidebar({ entries, selectedRunId, onSelect }: SpaceRunSidebarProps) {
  return (
    <Box className="cr-space-sidebar" component="nav" aria-label="运行实例列表">
      {entries.length === 0 ? (
        <Typography color="text.secondary" sx={{ padding: '12px 8px', fontSize: 12, textAlign: 'center' }}>
          暂无运行实例
        </Typography>
      ) : (
        <List dense disablePadding>
          {entries.map(entry => {
            const selected = entry.runId === selectedRunId
            const time = startedAtTime(entry.startedAt)
            const meta = time ? `${entryStatusLabel(entry)} · ${time}` : entryStatusLabel(entry)
            return (
              <ListItemButton
                key={entry.runId}
                selected={selected}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(entry.runId)}
                sx={{ gap: 1, alignItems: 'flex-start', borderRadius: '8px', px: 1, py: 0.75, mb: 0.5 }}
              >
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
            )
          })}
        </List>
      )}
    </Box>
  )
}
