import * as React from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import AddIcon from '@mui/icons-material/Add'
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined'
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import type { SpaceEntryCounts } from '../executionSpace'
import type { Repo } from '../types'
import { ProcessBadge } from './ProcessBadge'

const DRAG_HELP = '拖拽手柄调整顺序；按住 Ctrl 拖拽可移动命令或收藏夹'

type RepoPageProps = {
  repo: Repo
  processCounts: SpaceEntryCounts
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
  onBack: () => void
  onCreateCommand: () => void
  onAddFolder: () => void
  onEditRepo: () => void
  onOpenExecutionSpace: () => void
}

export function RepoPage({
  repo,
  processCounts,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onBack,
  onCreateCommand,
  onAddFolder,
  onEditRepo,
  onOpenExecutionSpace,
}: RepoPageProps) {
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
      <Tooltip title={DRAG_HELP} arrow placement="bottom">
        <IconButton size="small" aria-label="拖拽操作说明">
          <HelpOutlineOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Button size="small" aria-label="后退" disabled={!canGoBack} onClick={onGoBack} sx={{ minWidth: 0, px: 1 }}>
        <ArrowBackIcon fontSize="small" />
      </Button>
      <Button size="small" aria-label="前进" disabled={!canGoForward} onClick={onGoForward} sx={{ minWidth: 0, px: 1 }}>
        <ArrowForwardIcon fontSize="small" />
      </Button>
      <Button size="small" sx={{ gap: 0.75 }} onClick={onOpenExecutionSpace}>
        内置执行空间
        <ProcessBadge tone="running" count={processCounts.running} />
        <ProcessBadge tone="ended" count={processCounts.ended} />
      </Button>
      <Button size="small" onClick={onEditRepo}>仓库设置</Button>
      <Button size="small" startIcon={<CreateNewFolderOutlinedIcon fontSize="small" />} onClick={onAddFolder}>新建收藏夹</Button>
      <Button size="small" variant="contained" startIcon={<AddIcon fontSize="small" />} onClick={onCreateCommand}>新建命令</Button>
    </Box>
  )
}
