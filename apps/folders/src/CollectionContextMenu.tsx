import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import { Box, FormControl, InputLabel, ListItemIcon, ListItemText, Menu, MenuItem, Select } from '@mui/material'
import { ALL_VIEW_CATEGORY_ID } from './categoryRegistry'
import type { BlankContextMenuState, CategoryWorkspaceView, CollectionContainer, CollectionGroup, CollectionItem, ContextMenuState, DesktopGridEntry } from './types'

function suppressNativeContextMenu(event: React.MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

const COLLECTION_CONTEXT_MENU_SLOT_PROPS = {
  root: {
    sx: { pointerEvents: 'none' },
  },
  paper: {
    onContextMenu: suppressNativeContextMenu,
    sx: { pointerEvents: 'auto' },
  },
}

type CollectionContextMenuProps = {
  busy: boolean
  canCreateContainer: boolean
  canEdit: boolean
  doc: CategoryWorkspaceView
  groups: CollectionGroup[]
  menu: ContextMenuState
  onClose(): void
  onCreateContainer(): void
  onCreateGroup(): void
  onCreateItem(menu: BlankContextMenuState): void
  onCopyToGroup(item: CollectionItem, groupId: string): void
  onDelete(entry: DesktopGridEntry): void
  onEdit(item: CollectionItem): void
  onEditContainer(container: CollectionContainer): void
  onMoveToContainer(item: CollectionItem, containerId: string): void
  onMoveToGroup(item: CollectionItem, groupId: string): void
  onOpen(entry: DesktopGridEntry): void
  onOpenItem(item: CollectionItem): void
  onRemoveFromContainer(item: CollectionItem): void
}

export function CollectionContextMenu(props: CollectionContextMenuProps): React.ReactNode {
  const menu = props.menu
  const isAllView = props.doc.id === ALL_VIEW_CATEGORY_ID
  const anchorPosition = menu ? { left: menu.x, top: menu.y } : undefined
  const label = menu?.kind === 'desktop'
    ? '桌面空白处操作'
    : menu?.kind === 'container-blank'
      ? '收纳夹空白处操作'
    : menu?.kind === 'container-item'
      ? '收纳夹内图标操作'
      : '桌面图标操作'

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
      slotProps={COLLECTION_CONTEXT_MENU_SLOT_PROPS}
      MenuListProps={{ 'aria-label': label }}
    >
      {menu?.kind === 'desktop' ? (
        <DesktopBlankMenuItems
          busy={props.busy}
          canCreateContainer={props.canCreateContainer}
          canEdit={props.canEdit}
          isAllView={isAllView}
          onCreateContainer={() => runAndClose(props.onCreateContainer)}
          onCreateGroup={() => runAndClose(props.onCreateGroup)}
          onCreateItem={() => runAndClose(() => props.onCreateItem(menu))}
        />
      ) : menu?.kind === 'container-blank' ? (
        <ContainerBlankMenuItems
          busy={props.busy}
          canEdit={props.canEdit}
          isAllView={isAllView}
          onCreateItem={() => runAndClose(() => props.onCreateItem(menu))}
        />
      ) : menu?.kind === 'entry' ? (
        <DesktopEntryMenuItems
          busy={props.busy}
          doc={props.doc}
          entry={menu.entry}
          groups={props.groups}
          isAllView={isAllView}
          onCopyToGroup={(item, groupId) => runAndClose(() => props.onCopyToGroup(item, groupId))}
          onDelete={entry => runAndClose(() => props.onDelete(entry))}
          onEdit={item => runAndClose(() => props.onEdit(item))}
          onEditContainer={container => runAndClose(() => props.onEditContainer(container))}
          onMoveToContainer={(item, containerId) => runAndClose(() => props.onMoveToContainer(item, containerId))}
          onMoveToGroup={(item, groupId) => runAndClose(() => props.onMoveToGroup(item, groupId))}
          onOpen={entry => runAndClose(() => props.onOpen(entry))}
        />
      ) : menu?.kind === 'container-item' ? (
        <ContainerItemMenuItems
          busy={props.busy}
          container={menu.container}
          doc={props.doc}
          groups={props.groups}
          isAllView={isAllView}
          item={menu.item}
          onCopyToGroup={(item, groupId) => runAndClose(() => props.onCopyToGroup(item, groupId))}
          onDelete={item => runAndClose(() => props.onDelete(desktopEntryFromItem(item)))}
          onEdit={item => runAndClose(() => props.onEdit(item))}
          onMoveToContainer={(item, containerId) => runAndClose(() => props.onMoveToContainer(item, containerId))}
          onMoveToGroup={(item, groupId) => runAndClose(() => props.onMoveToGroup(item, groupId))}
          onOpen={item => runAndClose(() => props.onOpenItem(item))}
          onRemoveFromContainer={item => runAndClose(() => props.onRemoveFromContainer(item))}
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
        <ListItemText>新建收纳夹</ListItemText>
      </MenuItem>
      <MenuItem onClick={props.onCreateGroup} disabled={actionDisabled}>
        <ListItemIcon><CreateNewFolderRoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>新建分组</ListItemText>
      </MenuItem>
    </React.Fragment>
  )
}

function ContainerBlankMenuItems(props: {
  busy: boolean
  canEdit: boolean
  isAllView: boolean
  onCreateItem(): void
}) {
  const actionDisabled = props.busy || !props.canEdit || props.isAllView
  return (
    <MenuItem onClick={props.onCreateItem} disabled={actionDisabled}>
      <ListItemIcon><AddRoundedIcon fontSize="small" /></ListItemIcon>
      <ListItemText>新建</ListItemText>
    </MenuItem>
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

  return (
    <React.Fragment>
      <MenuItem onClick={() => props.onOpen(props.entry)}>
        <ListItemIcon><OpenInNewRoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>打开</ListItemText>
      </MenuItem>
      {item ? <ItemEditMenuItem item={item} isAllView={props.isAllView} onEdit={props.onEdit} /> : null}
      {container && !props.isAllView ? <MenuItem onClick={() => props.onEditContainer(container)}>
        <ListItemIcon><Inventory2RoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>编辑收纳夹</ListItemText>
      </MenuItem> : null}
      {item ? <ItemGroupTransferControls busy={props.busy} groups={props.groups} isAllView={props.isAllView} item={item} onCopyToGroup={props.onCopyToGroup} onMoveToGroup={props.onMoveToGroup} /> : null}
      {item ? <ItemContainerControl doc={props.doc} item={item} isAllView={props.isAllView} onMoveToContainer={props.onMoveToContainer} /> : null}
      <MenuItem onClick={() => props.onDelete(props.entry)} sx={{ color: 'error.main' }}>
        <ListItemIcon><DeleteOutlineRoundedIcon fontSize="small" color="error" /></ListItemIcon>
        <ListItemText>{props.isAllView ? '从全部移除' : '删除'}</ListItemText>
      </MenuItem>
    </React.Fragment>
  )
}

function ContainerItemMenuItems(props: {
  busy: boolean
  container: CollectionContainer
  doc: CategoryWorkspaceView
  groups: CollectionGroup[]
  isAllView: boolean
  item: CollectionItem
  onOpen(item: CollectionItem): void
  onEdit(item: CollectionItem): void
  onCopyToGroup(item: CollectionItem, groupId: string): void
  onMoveToGroup(item: CollectionItem, groupId: string): void
  onMoveToContainer(item: CollectionItem, containerId: string): void
  onRemoveFromContainer(item: CollectionItem): void
  onDelete(item: CollectionItem): void
}) {
  if (props.item.containerId !== props.container.id) throw new Error(`container menu item mismatch: ${props.item.id}`)

  return (
    <React.Fragment>
      <MenuItem onClick={() => props.onOpen(props.item)}>
        <ListItemIcon><OpenInNewRoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>打开</ListItemText>
      </MenuItem>
      <ItemEditMenuItem item={props.item} isAllView={props.isAllView} onEdit={props.onEdit} />
      {!props.isAllView ? <MenuItem onClick={() => props.onRemoveFromContainer(props.item)}>
        <ListItemIcon><LogoutRoundedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>移出到桌面</ListItemText>
      </MenuItem> : null}
      <ItemContainerControl doc={props.doc} item={props.item} isAllView={props.isAllView} onMoveToContainer={props.onMoveToContainer} />
      <ItemGroupTransferControls busy={props.busy} groups={props.groups} isAllView={props.isAllView} item={props.item} onCopyToGroup={props.onCopyToGroup} onMoveToGroup={props.onMoveToGroup} />
      <MenuItem onClick={() => props.onDelete(props.item)} sx={{ color: 'error.main' }}>
        <ListItemIcon><DeleteOutlineRoundedIcon fontSize="small" color="error" /></ListItemIcon>
        <ListItemText>删除</ListItemText>
      </MenuItem>
    </React.Fragment>
  )
}

function ItemEditMenuItem(props: { item: CollectionItem; isAllView: boolean; onEdit(item: CollectionItem): void }) {
  if (props.isAllView) return null
  return (
    <MenuItem onClick={() => props.onEdit(props.item)}>
      <ListItemIcon><EditRoundedIcon fontSize="small" /></ListItemIcon>
      <ListItemText>编辑</ListItemText>
    </MenuItem>
  )
}

function ItemGroupTransferControls(props: {
  busy: boolean
  groups: CollectionGroup[]
  isAllView: boolean
  item: CollectionItem
  onCopyToGroup(item: CollectionItem, groupId: string): void
  onMoveToGroup(item: CollectionItem, groupId: string): void
}) {
  if (props.isAllView) return null
  const targetGroups = props.groups.filter(group => group.id !== props.item.groupId)
  return (
    <Box sx={{ px: 2, py: 1, minWidth: 240, display: 'grid', gap: 1 }}>
      <FormControl variant="filled" fullWidth size="small" disabled={props.busy || !targetGroups.length}>
        <InputLabel id="context-move-group-label">移动到分类</InputLabel>
        <Select
          variant="filled"
          labelId="context-move-group-label"
          label="移动到分类"
          value=""
          onChange={event => props.onMoveToGroup(props.item, event.target.value)}
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
          onChange={event => props.onCopyToGroup(props.item, event.target.value)}
        >
          {targetGroups.map(group => <MenuItem key={group.id} value={group.id}><ListItemIcon><ContentCopyRoundedIcon fontSize="small" /></ListItemIcon>{group.name}</MenuItem>)}
        </Select>
      </FormControl>
    </Box>
  )
}

function ItemContainerControl(props: {
  doc: CategoryWorkspaceView
  isAllView: boolean
  item: CollectionItem
  onMoveToContainer(item: CollectionItem, containerId: string): void
}) {
  if (props.isAllView) return null
  const containers = props.doc.containers.filter(current => current.groupId === props.item.groupId)
  return (
    <Box sx={{ px: 2, py: 1, minWidth: 220 }}>
      <FormControl variant="filled" fullWidth size="small">
        <InputLabel id="context-container-label">收纳夹</InputLabel>
        <Select
          variant="filled"
          labelId="context-container-label"
          label="收纳夹"
          value={props.item.containerId || ''}
          onChange={event => props.onMoveToContainer(props.item, event.target.value)}
        >
          <MenuItem value="">桌面</MenuItem>
          {containers.map(current => <MenuItem key={current.id} value={current.id}>{current.name}</MenuItem>)}
        </Select>
      </FormControl>
    </Box>
  )
}

function desktopEntryFromItem(item: CollectionItem): DesktopGridEntry {
  return {
    kind: 'item',
    id: item.id,
    name: item.name,
    layout: item.layout,
    icon: item.icon,
    item,
  }
}
