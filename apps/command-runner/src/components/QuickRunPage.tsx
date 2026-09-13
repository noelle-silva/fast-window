import * as React from 'react'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import { QuickRunCard } from './QuickRunCard'
import type { CommandItem, QuickRun, Repo } from '../types'

type QuickRunPageProps = {
  quickRuns: QuickRun[]
  commands: CommandItem[]
  repos: Repo[]
  disabled?: boolean
  onBack: () => void
  onCreate: () => void
  onEdit: (quickRun: QuickRun) => void
  onDelete: (quickRun: QuickRun) => void
  onRun: (quickRun: QuickRun) => void
}

export function QuickRunPage({
  quickRuns,
  commands,
  repos,
  disabled = false,
  onBack,
  onCreate,
  onEdit,
  onDelete,
  onRun,
}: QuickRunPageProps) {
  const commandById = React.useMemo(() => new Map(commands.map(command => [command.id, command])), [commands])

  return (
    <Box className="cr-repo-page">
      <Box className="cr-repo-page-header">
        <Tooltip title="返回">
          <IconButton size="small" onClick={onBack} aria-label="返回">
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box className="cr-repo-page-heading">
          <Typography component="h1" sx={{ fontSize: 17, fontWeight: 900 }} noWrap>快捷运行</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>把多条命令编成一组，一键同时启动。</Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<AddIcon fontSize="small" />} disabled={disabled} onClick={onCreate}>
          新建快捷运行
        </Button>
      </Box>
      <Box className="cr-repo-grid" aria-label="快捷运行列表">
        {quickRuns.map(quickRun => {
          const items = quickRun.commandIds
            .map(id => commandById.get(id))
            .filter((command): command is CommandItem => Boolean(command))
          const repoIds = new Set(items.map(command => command.repoId))
          return (
            <QuickRunCard
              key={quickRun.id}
              quickRun={quickRun}
              commandNames={items.map(command => command.name)}
              repoCount={repoIds.size}
              disabled={disabled}
              onRun={() => onRun(quickRun)}
              onEdit={() => onEdit(quickRun)}
              onDelete={() => onDelete(quickRun)}
            />
          )
        })}
        {quickRuns.length === 0 ? (
          <Box className="cr-empty-state" sx={{ gridColumn: '1 / -1' }}>
            <Box component="strong" sx={{ fontSize: 14, fontWeight: 900 }}>还没有快捷运行</Box>
            <Box color="text.secondary" sx={{ fontSize: 12 }}>把常用的多条命令编成一组，以后一键就能全部启动。</Box>
            <Button size="small" variant="contained" disabled={disabled} onClick={onCreate}>新建快捷运行</Button>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}
