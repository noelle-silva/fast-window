import * as React from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AddIcon from '@mui/icons-material/Add'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import type { SpaceEntryCounts } from '../executionSpace'
import type { Repo } from '../types'
import { ProcessBadge } from './ProcessBadge'

type RepoPageProps = {
  repo: Repo
  processCounts: SpaceEntryCounts
  onBack: () => void
  onCreateCommand: () => void
  onEditRepo: () => void
  onOpenExecutionSpace: () => void
}

export function RepoPage({ repo, processCounts, onBack, onCreateCommand, onEditRepo, onOpenExecutionSpace }: RepoPageProps) {
  return (
    <Box className="cr-repo-page-header">
      <Tooltip title="返回仓库列表">
        <IconButton size="small" onClick={onBack} aria-label="返回仓库列表">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Box className="cr-repo-page-heading">
        <Typography component="h1" sx={{ fontSize: 17, fontWeight: 900 }} noWrap>{repo.name}</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 12 }} noWrap>{repo.path}</Typography>
      </Box>
      <Button size="small" sx={{ gap: 0.75 }} onClick={onOpenExecutionSpace}>
        内置执行空间
        <ProcessBadge tone="running" count={processCounts.running} />
        <ProcessBadge tone="ended" count={processCounts.ended} />
      </Button>
      <Button size="small" onClick={onEditRepo}>仓库设置</Button>
      <Button size="small" variant="contained" startIcon={<AddIcon fontSize="small" />} onClick={onCreateCommand}>新建命令</Button>
    </Box>
  )
}
