import * as React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import WindowRoundedIcon from '@mui/icons-material/WindowRounded'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'
import { isInteractiveTarget } from './utils'
import type { CollectionGroup, FwLaunchInfo, Phase, WorkspaceView } from './types'

const appWindow = getCurrentWindow()

export function MainTopbar(props: {
  busy: boolean
  doc: WorkspaceView
  groupId: string
  launchInfo: FwLaunchInfo
  phase: Phase
  search: string
  selectedGroup: CollectionGroup | undefined
  onAdd(): void
  onAddContainer(): void
  onGroupChange(groupId: string): void
  onOpenGroupEditor(): void
  onOpenSettings(): void
  onSearchChange(search: string): void
}) {
  const statusColor = props.phase === 'failed' ? 'error' : 'warning'
  const statusText = props.phase === 'data-error' ? '数据异常' : props.phase === 'failed' ? '需处理' : '加载中'
  const canEdit = props.phase === 'ready'
  const groupActionLabel = props.selectedGroup ? '编辑分组' : '新分组'

  return (
    <Paper
      square
      elevation={0}
      onPointerDown={event => { if (event.button === 0 && !isInteractiveTarget(event.target)) void appWindow.startDragging() }}
      sx={{
        minHeight: 56,
        px: { xs: 1.25, sm: 1.5 },
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        bgcolor: 'transparent',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        borderBottom: '1px solid transparent',
        boxShadow: 'none',
        userSelect: 'none',
        flexShrink: 0,
        flexWrap: { xs: 'wrap', md: 'nowrap' },
        py: { xs: 1, md: 0.75 },
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flex: '1 1 auto', minWidth: 0, flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
        <TextField
          value={props.search}
          onChange={event => props.onSearchChange(event.target.value)}
          placeholder="按名称或网址搜索"
          size="small"
          sx={{ flex: { xs: '1 1 100%', sm: '0 1 150px' }, minWidth: { xs: '100%', sm: 120 }, maxWidth: { xs: '100%', sm: 150 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
        />
        <GroupFilterSelect doc={props.doc} groupId={props.groupId} onGroupChange={props.onGroupChange} />
        {props.phase !== 'ready' ? <Chip color={statusColor} size="small" label={statusText} icon={props.phase === 'starting' ? <CircularProgress size={12} color="inherit" /> : undefined} /> : null}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: '0 0 auto' }}>
          <Button variant="text" startIcon={<SettingsRoundedIcon />} onClick={props.onOpenSettings}>设置</Button>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={!canEdit || props.busy}>新增</Button>
          <Button variant="text" startIcon={<Inventory2RoundedIcon />} onClick={props.onAddContainer} disabled={!canEdit || props.busy || !props.selectedGroup}>收纳夹</Button>
          <Button
            variant="text"
            startIcon={props.selectedGroup ? <EditRoundedIcon /> : <CreateNewFolderRoundedIcon />}
            onClick={props.onOpenGroupEditor}
            disabled={!canEdit}
            sx={{ minWidth: 108 }}
          >
            {groupActionLabel}
          </Button>
        </Stack>
      </Stack>
      <WindowControlsDock standalone={props.launchInfo.standalone} />
    </Paper>
  )
}

function GroupFilterSelect(props: { doc: WorkspaceView; groupId: string; onGroupChange(groupId: string): void }) {
  const [open, setOpen] = React.useState(false)

  return (
    <FormControl variant="filled" size="small" sx={{ width: { xs: 'calc(50% - 6px)', sm: 180 }, minWidth: 148 }}>
      <InputLabel id="collections-group-filter-label">分组</InputLabel>
      <Select
        variant="filled"
        labelId="collections-group-filter-label"
        value={props.groupId}
        label="分组"
        open={open}
        onClose={() => setOpen(false)}
        onOpen={() => setOpen(true)}
        onMouseDown={event => {
          if (!open) return
          event.preventDefault()
          setOpen(false)
        }}
        onChange={(event: SelectChangeEvent) => {
          props.onGroupChange(event.target.value)
          setOpen(false)
        }}
      >
        {props.doc.groups.length ? props.doc.groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>) : <MenuItem value="" disabled>暂无分组</MenuItem>}
      </Select>
    </FormControl>
  )
}

function WindowControlsDock(props: { standalone: boolean }) {
  if (!props.standalone) return null
  return (
    <Box sx={{ ml: 'auto', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flex: '0 0 auto' }}>
      <Stack direction="row" spacing={0.5} data-window-control>
        <Tooltip title="最小化"><IconButton aria-label="最小化" onClick={() => appWindow.minimize()}><HorizontalRuleRoundedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="最大化或还原"><IconButton aria-label="最大化或还原" onClick={() => appWindow.toggleMaximize()}><WindowRoundedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="隐藏到托盘"><IconButton aria-label="隐藏到托盘" onClick={() => invoke('hide_to_tray')}><CloseRoundedIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>
    </Box>
  )
}
