import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import { Box, FormControl, InputLabel, ListItemIcon, ListItemText, Menu, MenuItem, Select } from '@mui/material'
import { ALL_VIEW_CATEGORY_ID } from './categoryRegistry'
import type { CategoryWorkspaceView, CollectionContainer, CollectionGroup, CollectionItem, ContextMenuState, DesktopGridEntry } from './types'

function suppressNativeContextMenu(event: React.MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

const DESKTOP_CONTEXT_MENU_SLOT_PROPS = {
  root: {
    sx: { pointerEvents: 'none' },
  },
  paper: {
    onContextMenu: suppressNativeContextMenu,
    sx: { pointerEvents: 'auto' },
  },
}

type DesktopContextMenuProps = {
  busy: boolean
  canCreateContainer: boolean
  canEdit: boolean
  doc: CategoryWorkspaceView
  groups: CollectionGroup[]
  menu: ContextMenuState
  onClose(): void
  onCreateContainer(): void
  onCreateGroup(): void
  onCreateItem(): void
  onCopyToGroup(item: CollectionItem, groupId: string): void
  onDelete(entry: DesktopGridEntry): void
  onEdit(item: CollectionItem): void
  onEditContainer(container: CollectionContainer): void
  onMoveToContainer(item: CollectionItem, containerId: string): void
  onMoveToGroup(item: CollectionItem, groupId: string): void
  onOpen(entry: DesktopGridEntry): void
}

export function DesktopContextMenu(props: DesktopContextMenuProps): React.ReactNode {
  const menu = props.menu
  const isAllView = props.doc.id === ALL_VIEW_CATEGORY_ID
  const anchorPosition = menu ? { left: menu.x, top: menu.y } : undefined

  const runAndClose = (action: () => void) => {
    props.onClose()
    action()
  }

  return (
    <Menu
      open={Boolean(menu)}
      onClose={props.onClose}
      anchorReference="anchorPosition"
      anchorPosition={anchorPosition}
      onClick={event => event.stopPropagation()}
      slotProps={DESKTOP_CONTEXT_MENU_SLOT_PROPS}
      MenuListProps={{ 'aria-label': menu?.kind === 'desktop' ? '桌面空白处操作' : '桌面图标操作' }}
    >
      {menu?.kind === 'desktop' ? (
        <DesktopBlankMenuItems
          busy={props.busy}
          canCreateContainer={props.canCreateContainer}
          canEdit={props.canEdit}
          isAllView={isAllView}
          onCreateContainer={() => runAndClose(props.onCreateContainer)}
          onCreateGroup={() => runAndClose(props.onCreateGroup)}
          onCreateItem={() => runAndClose(props.onCreateItem)}
        />
      ) : menu?.kind === 'entry' ? (
        <DesktopEntryMenuItems
          busy={props.busy}
          doc={props.doc}
          entry={menu.entry}
          groups={props.groups}
          isAllView={isAllView}
          onCopyToGroup={props.onCopyToGroup}
          onDelete={props.onDelete}
          onEdit={props.onEdit}
          onEditContainer={props.onEditContainer}
          onMoveToContainer={props.onMoveToContainer}
          onMoveToGroup={props.onMoveToGroup}
          onOpen={props.onOpen}
        />
      ) : null}
    </Menu>
  )
}

function DesktopBlankMenuItems(props: {
  busy: boolean
  canCreateContainer: boolean
  canEdit: boolean
  isAllView: boolean
  onCreateContainer(): void
  onCreateGroup(): void
  onCreateItem(): void
}) {
  const actionDisabled = props.busy || !props.canEdit || props.isAllView
  return (
    <React.Fragment>
      <MenuItem onClick={props.onCreateItem} disabled={actionDisabled}>
        <ListItemIcon><AddRoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>新建</ListItemText>
      </MenuItem>
      <MenuItem onClick={props.onCreateContainer} disabled={actionDisabled || !props.canCreateContainer}>
        <ListItemIcon><Inventory2RoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>新建收纳架</ListItemText>
      </MenuItem>
      <MenuItem onClick={props.onCreateGroup} disabled={actionDisabled}>
        <ListItemIcon><CreateNewFolderRoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>新建分组</ListItemText>
      </MenuItem>
    </React.Fragment>
  )
}

function DesktopEntryMenuItems(props: {
  busy: boolean
  doc: CategoryWorkspaceView
  entry: DesktopGridEntry
  groups: CollectionGroup[]
  isAllView: boolean
  onOpen(entry: DesktopGridEntry): void
  onEdit(item: CollectionItem): void
  onEditContainer(container: CollectionContainer): void
  onCopyToGroup(item: CollectionItem, groupId: string): void
  onMoveToGroup(item: CollectionItem, groupId: string): void
  onMoveToContainer(item: CollectionItem, containerId: string): void
  onDelete(entry: DesktopGridEntry): void
}) {
  const item = props.entry.kind === 'item' ? props.doc.items.find(current => current.id === props.entry.id) || props.entry.item : null
  const container = props.entry.kind === 'container' ? props.entry.container : null
  const targetGroups = item ? props.groups.filter(group => group.id !== item.groupId) : []

  return (
    <React.Fragment>
      <MenuItem onClick={() => props.onOpen(props.entry)}>
        <ListItemIcon><OpenInNewRoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>打开</ListItemText>
      </MenuItem>
      {item && !props.isAllView ? <MenuItem onClick={() => props.onEdit(item)}>
        <ListItemIcon><EditRoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>编辑</ListItemText>
      </MenuItem> : null}
      {container && !props.isAllView ? <MenuItem onClick={() => props.onEditContainer(container)}>
        <ListItemIcon><Inventory2RoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>编辑收纳夹</ListItemText>
      </MenuItem> : null}
      {item && !props.isAllView ? <Box sx={{ px: 2, py: 1, minWidth: 240, display: 'grid', gap: 1 }}>
        <FormControl variant="filled" fullWidth size="small" disabled={props.busy || !targetGroups.length}>
          <InputLabel id="context-move-group-label">移动到分类</InputLabel>
          <Select
            variant="filled"
            labelId="context-move-group-label"
            label="移动到分类"
            value=""
            onChange={event => props.onMoveToGroup(item, event.target.value)}
          >
            {targetGroups.map(group => <MenuItem key={group.id} value={group.id}><ListItemIcon><DriveFileMoveRoundedIcon fontSize="small" /></ListItemIcon>{group.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl variant="filled" fullWidth size="small" disabled={props.busy || !targetGroups.length}>
          <InputLabel id="context-copy-group-label">复制到分类</InputLabel>
          <Select
            variant="filled"
            labelId="context-copy-group-label"
            label="复制到分类"
            value=""
            onChange={event => props.onCopyToGroup(item, event.target.value)}
          >
            {targetGroups.map(group => <MenuItem key={group.id} value={group.id}><ListItemIcon><ContentCopyRoundedIcon fontSize="small" /></ListItemIcon>{group.name}</MenuItem>)}
          </Select>
        </FormControl>
      </Box> : null}
      {item && !props.isAllView ? <Box sx={{ px: 2, py: 1, minWidth: 220 }}>
        <FormControl variant="filled" fullWidth size="small">
          <InputLabel id="context-container-label">收纳夹</InputLabel>
          <Select
            variant="filled"
            labelId="context-container-label"
            label="收纳夹"
            value={item.containerId || ''}
            onChange={event => props.onMoveToContainer(item, event.target.value)}
          >
            <MenuItem value="">桌面</MenuItem>
            {props.doc.containers.filter(current => current.groupId === item.groupId).map(current => <MenuItem key={current.id} value={current.id}>{current.name}</MenuItem>)}
          </Select>
        </FormControl>
      </Box> : null}
      <MenuItem onClick={() => props.onDelete(props.entry)} sx={{ color: 'error.main' }}>
        <ListItemIcon><DeleteOutlineRoundedIcon fontSize="small" color="error" /></ListItemIcon>
        <ListItemText>{props.isAllView ? '从全部移除' : '删除'}</ListItemText>
      </MenuItem>
    </React.Fragment>
  )
}
