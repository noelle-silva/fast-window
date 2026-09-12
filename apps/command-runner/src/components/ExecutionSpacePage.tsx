import * as React from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import type { SpaceEntry } from '../executionSpace'
import { SpaceRunDetail } from './SpaceRunDetail'
import { SpaceRunSidebar } from './SpaceRunSidebar'

type ExecutionSpacePageProps = {
  repoName: string
  entries: SpaceEntry[]
  stoppingRunIds: Set<string>
  onBack: () => void
  onStopRun: (runId: string) => void
  onRemoveEntry: (runId: string) => void
  onToggleCollapse: (runId: string) => void
}

export function ExecutionSpacePage({
  repoName,
  entries,
  stoppingRunIds,
  onBack,
  onStopRun,
  onRemoveEntry,
  onToggleCollapse,
}: ExecutionSpacePageProps) {
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null)
  const knownRunIdsRef = React.useRef<ReadonlySet<string>>(new Set())

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
        <Tooltip title="返回仓库命令列表">
          <IconButton size="small" onClick={onBack} aria-label="返回仓库命令列表">
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box className="cr-repo-page-heading">
          <Typography component="h1" sx={{ fontSize: 17, fontWeight: 900 }} noWrap>内置执行空间 · {repoName}</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>以内置模式运行的命令会在这里实时输出，输出不经过独立窗口。</Typography>
        </Box>
      </Box>

      <Box className="cr-space-layout">
        <SpaceRunSidebar
          entries={entries}
          selectedRunId={selectedEntry?.runId ?? null}
          onSelect={setSelectedRunId}
        />
        <SpaceRunDetail
          entry={selectedEntry}
          stoppingRunIds={stoppingRunIds}
          onStopRun={onStopRun}
          onRemoveEntry={onRemoveEntry}
          onToggleCollapse={onToggleCollapse}
        />
      </Box>
    </Box>
  )
}
