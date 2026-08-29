import * as React from 'react'
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'

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

export type ContextMenuAction = {
  id: string
  label: string
  icon?: React.ReactNode
  danger?: boolean
  onSelect: () => void
}

export type ContextMenuEntry = {
  id: string
  label: string
  icon?: React.ReactNode
  danger?: boolean
  onSelect?: () => void
  children?: ContextMenuAction[]
}

type SubMenuState = {
  parentId: string
  anchorEl: HTMLElement
} | null

type Props = {
  open: boolean
  x: number
  y: number
  entries: ContextMenuEntry[]
  onClose: () => void
}

export function IndexPageContextMenu(props: Props): React.ReactNode {
  const { open, x, y, entries, onClose } = props
  const [subMenu, setSubMenu] = React.useState<SubMenuState>(null)

  React.useEffect(() => {
    if (!open) setSubMenu(null)
  }, [open])

  React.useEffect(() => {
    setSubMenu(null)
  }, [x, y])

  const openSubMenu = React.useCallback((entry: ContextMenuEntry, anchorEl: HTMLElement) => {
    if (!entry.children?.length) return
    setSubMenu({ parentId: entry.id, anchorEl })
  }, [])

  const closeSubMenu = React.useCallback(() => {
    setSubMenu(null)
  }, [])

  useCloseOnOutsidePrimaryPointer(open || Boolean(subMenu), onClose)

  const subMenuActions = React.useMemo(() => {
    if (!subMenu) return []
    return entries.find(entry => entry.id === subMenu.parentId)?.children ?? []
  }, [entries, subMenu])

  const renderRootEntry = (entry: ContextMenuEntry) => {
    const hasChildren = !!entry.children?.length
    return (
      <MenuItem
        key={entry.id}
        onMouseEnter={event => {
          if (openSubMenu && hasChildren) openSubMenu(entry, event.currentTarget)
          else closeSubMenu()
        }}
        onKeyDown={event => {
          if (hasChildren && event.key === 'ArrowRight') {
            event.preventDefault()
            openSubMenu(entry, event.currentTarget)
          }
          if (!hasChildren && event.key === 'ArrowLeft') {
            event.preventDefault()
            closeSubMenu()
          }
        }}
        onClick={event => {
          event.stopPropagation()
          if (hasChildren) {
            openSubMenu(entry, event.currentTarget)
            return
          }
        }}
        aria-haspopup="menu"
        aria-expanded={subMenu?.parentId === entry.id}
      >
        {entry.icon ? <ListItemIcon>{entry.icon}</ListItemIcon> : null}
        <ListItemText primary={entry.label} />
        {hasChildren ? <KeyboardArrowRightRoundedIcon fontSize="small" sx={{ ml: 2, opacity: 0.64 }} /> : null}
      </MenuItem>
    )
  }

  const renderSubAction = (action: ContextMenuAction) => (
    <MenuItem
      key={action.id}
      sx={action.danger ? { color: 'var(--hc-danger)' } : undefined}
      onClick={event => {
        event.stopPropagation()
        onClose()
        action.onSelect()
      }}
    >
      {action.icon ? <ListItemIcon sx={action.danger ? { color: 'inherit' } : undefined}>{action.icon}</ListItemIcon> : null}
      <ListItemText primary={action.label} />
    </MenuItem>
  )

  return (
    <>
      <Menu
        open={open}
        onClose={onClose}
        anchorReference="anchorPosition"
        anchorPosition={open ? { top: y, left: x } : { top: 0, left: 0 }}
        onClick={event => event.stopPropagation()}
        slotProps={CONTEXT_MENU_SLOT_PROPS}
      >
        {entries.map(renderRootEntry)}
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
}
