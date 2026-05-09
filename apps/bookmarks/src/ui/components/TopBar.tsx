import * as React from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import WindowRoundedIcon from '@mui/icons-material/WindowRounded'
import { Button, Chip, CircularProgress, FormControl, IconButton, InputAdornment, InputLabel, MenuItem, Paper, Select, Stack, TextField, Tooltip } from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'
import type { BookmarkData, BookmarkGroup, FwLaunchInfo, Phase } from '../types'
import { ALL_GROUP_ID, DEFAULT_GROUP_ID, isInteractiveTarget, sortedGroups } from '../utils'

const appWindow = getCurrentWindow()

type TopBarProps = {
  busy: boolean
  data: BookmarkData
  groupId: string
  launchInfo: FwLaunchInfo
  phase: Phase
  search: string
  selectedGroup: BookmarkGroup | undefined
  onAdd(): void
  onGroupChange(groupId: string): void
  onOpenGroupEditor(): void
  onOpenSettings(): void
  onSearchChange(search: string): void
}

export function TopBar(props: TopBarProps): React.ReactNode {
  const statusColor = props.phase === 'failed' ? 'error' : 'warning'
  const statusText = props.phase === 'failed' ? '需处理' : '启动中'
  const canEdit = props.phase === 'ready'
  const groupActionLabel = props.selectedGroup && props.selectedGroup.id !== DEFAULT_GROUP_ID ? '编辑分组' : '新分组'

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
        bgcolor: 'rgba(255, 255, 255, 0.72)',
        backdropFilter: 'blur(18px) saturate(1.18)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.18)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.46)',
        boxShadow: '0 12px 30px rgba(15, 23, 42, 0.1)',
        userSelect: 'none',
        flexShrink: 0,
        flexWrap: { xs: 'wrap', md: 'nowrap' },
        py: { xs: 1, md: 0.75 },
      }}
    >
      <TextField
        value={props.search}
        onChange={event => props.onSearchChange(event.target.value)}
        placeholder="按标题或 URL 搜索"
        size="small"
        sx={{ flex: { xs: '1 1 100%', sm: '0 1 150px' }, minWidth: { xs: '100%', sm: 130 }, maxWidth: { xs: '100%', sm: 170 } }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
      />
      <GroupFilterSelect data={props.data} groupId={props.groupId} onGroupChange={props.onGroupChange} />
      {props.phase !== 'ready' ? <Chip color={statusColor} size="small" label={statusText} icon={props.phase === 'starting' ? <CircularProgress size={12} color="inherit" /> : undefined} /> : null}
      <Button variant="text" startIcon={<SettingsRoundedIcon />} onClick={props.onOpenSettings}>设置</Button>
      <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={!canEdit || props.busy}>新增</Button>
      <Button variant="text" startIcon={<EditRoundedIcon />} onClick={props.onOpenGroupEditor} disabled={!canEdit} sx={{ minWidth: 96 }}>{groupActionLabel}</Button>
      {props.launchInfo.standalone ? <WindowControls /> : null}
    </Paper>
  )
}

function GroupFilterSelect(props: { data: BookmarkData; groupId: string; onGroupChange(groupId: string): void }) {
  const [open, setOpen] = React.useState(false)
  const groups = sortedGroups(props.data.groups)

  return (
    <FormControl variant="filled" size="small" sx={{ width: { xs: 'calc(50% - 6px)', sm: 180 }, minWidth: 148 }}>
      <InputLabel id="bookmarks-group-filter-label">分组</InputLabel>
      <Select
        variant="filled"
        labelId="bookmarks-group-filter-label"
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
        <MenuItem value={ALL_GROUP_ID}>全部分组</MenuItem>
        {groups.map(group => <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>)}
      </Select>
    </FormControl>
  )
}

function WindowControls() {
  return (
    <Stack direction="row" spacing={0.5} data-window-control="true">
      <Tooltip title="最小化"><IconButton aria-label="最小化" onClick={() => appWindow.minimize()}><HorizontalRuleRoundedIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="最大化或还原"><IconButton aria-label="最大化或还原" onClick={() => appWindow.toggleMaximize()}><WindowRoundedIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="隐藏窗口"><IconButton aria-label="隐藏窗口" onClick={() => appWindow.hide()}><CloseRoundedIcon fontSize="small" /></IconButton></Tooltip>
    </Stack>
  )
}
