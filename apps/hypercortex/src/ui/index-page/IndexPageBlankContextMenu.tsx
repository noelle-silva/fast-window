import * as React from 'react'
import { ListItemText, Menu, MenuItem } from '@mui/material'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import type { AddKind } from './types'

const CONTEXT_MENU_PAPER_ATTR = 'data-hc-index-context-menu-paper'

function suppressNativeContextMenu(event: React.MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

const CONTEXT_MENU_SLOT_PROPS = {
  root: {
    sx: { pointerEvents: 'none' },
  },
  paper: {
    [CONTEXT_MENU_PAPER_ATTR]: 'true',
    onContextMenu: suppressNativeContextMenu,
    sx: { pointerEvents: 'auto' },
  },
}

function useCloseOnOutsidePrimaryPointer(open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return undefined

    const closeOnOutsidePrimaryPointer = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target
      if (target instanceof Element && target.closest(`[${CONTEXT_MENU_PAPER_ATTR}="true"]`)) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }

    document.addEventListener('pointerdown', closeOnOutsidePrimaryPointer, { capture: true })
    return () => document.removeEventListener('pointerdown', closeOnOutsidePrimaryPointer, { capture: true })
  }, [onClose, open])
}

type MenuAction = {
  id: string
  label: string
  onSelect: () => void
}

type RootAction = {
  id: 'add' | 'create'
  label: string
  children: MenuAction[]
}

type SubMenuState = {
  parentId: 'add' | 'create'
  anchorEl: HTMLElement
} | null

type Props = {
  onAddExisting: (kind: AddKind) => void
  onCreateNew: (kind: AddKind) => void
}

export type IndexPageBlankContextMenuHandle = {
  open: (e: React.MouseEvent) => void
}

export const IndexPageBlankContextMenu = React.forwardRef<IndexPageBlankContextMenuHandle, Props>(function IndexPageBlankContextMenu(props, ref) {
  const { onAddExisting, onCreateNew } = props
  const [anchorPos, setAnchorPos] = React.useState<{ top: number; left: number } | null>(null)
  const [subMenu, setSubMenu] = React.useState<SubMenuState>(null)

  const open = Boolean(anchorPos)

  const pickAdd = React.useCallback(
    (kind: AddKind) => {
      onAddExisting(kind)
    },
    [onAddExisting],
  )

  const pickCreate = React.useCallback(
    (kind: AddKind) => {
      onCreateNew(kind)
    },
    [onCreateNew],
  )

  const actions: RootAction[] = [
    {
      id: 'add',
      label: '添加已有',
      children: [
        { id: 'add-folder', label: '已有收藏夹', onSelect: () => pickAdd('folder') },
        { id: 'add-note', label: '已有笔记', onSelect: () => pickAdd('note') },
        { id: 'add-asset', label: '已有附件', onSelect: () => pickAdd('asset') },
      ],
    },
    {
      id: 'create',
      label: '新建内容',
      children: [
        { id: 'create-folder', label: '新收藏夹', onSelect: () => pickCreate('folder') },
        { id: 'create-note', label: '新笔记', onSelect: () => pickCreate('note') },
        { id: 'create-asset', label: '上传附件', onSelect: () => pickCreate('asset') },
      ],
    },
  ]

  const openRoot = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setAnchorPos({ top: e.clientY, left: e.clientX })
    setSubMenu(null)
  }, [])

  React.useImperativeHandle(ref, () => ({ open: openRoot }), [openRoot])

  const closeAll = React.useCallback(() => {
    setSubMenu(null)
    setAnchorPos(null)
  }, [])

  const openSubMenu = React.useCallback((action: RootAction, anchorEl: HTMLElement) => {
    setSubMenu({ parentId: action.id, anchorEl })
  }, [])

  const closeSubMenu = React.useCallback(() => {
    setSubMenu(null)
  }, [])

  React.useEffect(() => {
    if (!open) setSubMenu(null)
  }, [open])

  useCloseOnOutsidePrimaryPointer(open || Boolean(subMenu), closeAll)

  const renderRootAction = (action: RootAction) => {
    const hasChildren = action.children.length > 0
    return (
      <MenuItem
        key={action.id}
        onMouseEnter={event => {
          if (!hasChildren) {
            closeSubMenu()
            return
          }
          openSubMenu(action, event.currentTarget)
        }}
        onKeyDown={event => {
          if (hasChildren && event.key === 'ArrowRight') {
            event.preventDefault()
            openSubMenu(action, event.currentTarget)
          }
        }}
        onClick={event => {
          event.stopPropagation()
          if (hasChildren) {
            openSubMenu(action, event.currentTarget)
            return
          }
        }}
        aria-haspopup="menu"
        aria-expanded={subMenu?.parentId === action.id}
      >
        <ListItemText primary={action.label} />
        {hasChildren ? <KeyboardArrowRightRoundedIcon fontSize="small" sx={{ ml: 2, opacity: 0.64 }} /> : null}
      </MenuItem>
    )
  }

  const subMenuActions = subMenu ? actions.find(action => action.id === subMenu.parentId)?.children ?? [] : []

  const renderSubAction = (action: MenuAction) => (
    <MenuItem
      key={action.id}
      onClick={event => {
        event.stopPropagation()
        closeAll()
        action.onSelect()
      }}
    >
      <ListItemText primary={action.label} />
    </MenuItem>
  )

  return (
    <>
      <Menu
        open={open}
        onClose={closeAll}
        anchorReference="anchorPosition"
        anchorPosition={anchorPos ?? { top: 0, left: 0 }}
        onClick={event => event.stopPropagation()}
        slotProps={CONTEXT_MENU_SLOT_PROPS}
      >
        {actions.map(renderRootAction)}
      </Menu>
      <Menu
        open={Boolean(subMenu)}
        anchorEl={subMenu?.anchorEl ?? null}
        onClose={closeSubMenu}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={event => event.stopPropagation()}
        slotProps={CONTEXT_MENU_SLOT_PROPS}
      >
        {subMenuActions.map(renderSubAction)}
      </Menu>
    </>
  )
})
