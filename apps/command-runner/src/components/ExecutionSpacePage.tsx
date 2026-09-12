import * as React from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import type { SpaceEntry } from '../executionSpace'
import { SpaceRunDetail } from './SpaceRunDetail'
import { SpaceRunSidebar } from './SpaceRunSidebar'

type ExecutionSpacePageProps = {
  title: string
  subtitle: string
  entries: SpaceEntry[]
  repoNames?: ReadonlyMap<string, string>
  stoppingRunIds: Set<string>
  onBack: () => void
  onStopRun: (runId: string) => void
  onRemoveEntry: (runId: string) => void
  onRerun: (commandId: string) => void
  onMoveEntry: (activeRunId: string, overRunId: string) => void
  onStopAll?: () => void
}

export function ExecutionSpacePage({
  title,
  subtitle,
  entries,
  repoNames,
  stoppingRunIds,
  onBack,
  onStopRun,
  onRemoveEntry,
  onRerun,
  onMoveEntry,
  onStopAll,
}: ExecutionSpacePageProps) {
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null)
  const knownRunIdsRef = React.useRef<ReadonlySet<string>>(new Set())
  const runningCount = entries.filter(entry => entry.status === 'running').length

  const closeMenu = React.useCallback(() => setMenuAnchor(null), [])

  React.useLayoutEffect(() => {
    const known = knownRunIdsRef.current
    const appended = entries.filter(entry => !known.has(entry.runId))
    knownRunIdsRef.current = new Set(entries.map(entry => entry.runId))

    setSelectedRunId(current => {
      if (appended.length > 0) return appended[appended.length - 1].runId
      if (current && entries.some(entry => entry.runId === current)) return current
      return entries.length > 0 ? entries[entries.length - 1].runId : null
    })
  }, [entries])

  const selectedEntry = entries.find(entry => entry.runId === selectedRunId) || null

  return (
    <Box className="cr-repo-page">
      <Box className="cr-repo-page-header">
        <Tooltip title="返回">
          <IconButton size="small" onClick={onBack} aria-label="返回">
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box className="cr-repo-page-heading">
          <Typography component="h1" sx={{ fontSize: 17, fontWeight: 900 }} noWrap>{title}</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>{subtitle}</Typography>
        </Box>
        {onStopAll ? (
          <>
            <Tooltip title="更多操作">
              <IconButton size="small" aria-label="更多操作" onClick={event => setMenuAnchor(event.currentTarget)}>
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
              <MenuItem
                disabled={runningCount === 0}
                onClick={() => {
                  closeMenu()
                  onStopAll()
                }}
              >
                停止全部{runningCount > 0 ? `（${runningCount} 个运行中）` : ''}
              </MenuItem>
            </Menu>
          </>
        ) : null}
      </Box>

      <Box className="cr-space-layout">
        <SpaceRunSidebar
          entries={entries}
          repoNames={repoNames}
          selectedRunId={selectedEntry?.runId ?? null}
          onSelect={setSelectedRunId}
          onMove={onMoveEntry}
        />
        <SpaceRunDetail
          entry={selectedEntry}
          stoppingRunIds={stoppingRunIds}
          onStopRun={onStopRun}
          onRemoveEntry={onRemoveEntry}
          onRerun={onRerun}
        />
      </Box>
    </Box>
  )
}
