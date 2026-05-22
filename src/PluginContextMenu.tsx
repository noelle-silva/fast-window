import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListItemText, Menu, MenuItem } from '@mui/material'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import type { Plugin } from './constants'

const HOST_CONTEXT_MENU_PAPER_ATTR = 'data-host-context-menu-paper'

function suppressNativeContextMenu(event: React.MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

const HOST_CONTEXT_MENU_SLOT_PROPS = {
  root: {
    sx: { pointerEvents: 'none' },
  },
  paper: {
    [HOST_CONTEXT_MENU_PAPER_ATTR]: 'true',
    onContextMenu: suppressNativeContextMenu,
    sx: { pointerEvents: 'auto' },
  },
}

function useCloseOnOutsidePrimaryPointer(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return undefined

    const closeOnOutsidePrimaryPointer = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target
      if (target instanceof Element && target.closest(`[${HOST_CONTEXT_MENU_PAPER_ATTR}="true"]`)) return
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
  disabled?: boolean
  color?: 'error' | 'inherit'
  onSelect?: () => void
  children?: ContextMenuAction[]
}

type ContextMenuLevel = 'root' | 'submenu'

type SubMenuState = {
  parentId: string
  anchorEl: HTMLElement
} | null

interface PluginContextMenuProps {
  plugin: Plugin | null
  mouseX: number
  mouseY: number
  actions: ContextMenuAction[]
  onClose: () => void
}

export default function PluginContextMenu({
  plugin, mouseX, mouseY,
  actions, onClose,
}: PluginContextMenuProps) {
  const open = !!plugin
  const [subMenu, setSubMenu] = useState<SubMenuState>(null)

  const subMenuActions = useMemo(() => {
    if (!subMenu) return []
    return actions.find(action => action.id === subMenu.parentId)?.children ?? []
  }, [actions, subMenu])

  const openSubMenu = useCallback((action: ContextMenuAction, anchorEl: HTMLElement) => {
    if (!action.children?.length || action.disabled) return
    setSubMenu({ parentId: action.id, anchorEl })
  }, [])

  const closeAll = useCallback(() => {
    setSubMenu(null)
    onClose()
  }, [onClose])

  const closeSubMenu = useCallback(() => {
    setSubMenu(null)
  }, [])

  useEffect(() => {
    if (!open) closeSubMenu()
  }, [closeSubMenu, open])

  useEffect(() => {
    if (!subMenu) return
    const activeSubmenuStillExists = actions.some(action => action.id === subMenu.parentId && !!action.children?.length)
    if (!activeSubmenuStillExists) closeSubMenu()
  }, [actions, closeSubMenu, subMenu])

  useCloseOnOutsidePrimaryPointer(open || !!subMenu, closeAll)

  const renderAction = (action: ContextMenuAction, level: ContextMenuLevel) => {
    const hasChildren = !!action.children?.length

    return (
      <MenuItem
        key={action.id}
        disabled={action.disabled}
        sx={action.color === 'error' ? { color: 'error.main' } : undefined}
        onMouseEnter={event => {
          if (level === 'root' && (!hasChildren || action.disabled)) {
            closeSubMenu()
            return
          }
          if (level !== 'root') return
          openSubMenu(action, event.currentTarget)
        }}
        onKeyDown={event => {
          if (level === 'root' && hasChildren && event.key === 'ArrowRight') {
            event.preventDefault()
            openSubMenu(action, event.currentTarget)
          }
          if (level === 'submenu' && event.key === 'ArrowLeft') {
            event.preventDefault()
            closeSubMenu()
          }
        }}
        onClick={event => {
          event.stopPropagation()
          if (hasChildren) {
            openSubMenu(action, event.currentTarget)
            return
          }
          closeAll()
          action.onSelect?.()
        }}
        aria-haspopup={hasChildren ? 'menu' : undefined}
        aria-expanded={hasChildren ? subMenu?.parentId === action.id : undefined}
      >
        <ListItemText primary={action.label} />
        {hasChildren ? <KeyboardArrowRightRoundedIcon fontSize="small" sx={{ ml: 2, opacity: 0.64 }} /> : null}
      </MenuItem>
    )
  }

  return (
    <>
      <Menu
        open={open}
        onClose={closeAll}
        anchorReference="anchorPosition"
        anchorPosition={open ? { top: mouseY, left: mouseX } : { top: 0, left: 0 }}
        onClick={event => event.stopPropagation()}
        slotProps={HOST_CONTEXT_MENU_SLOT_PROPS}
      >
        {actions.map(action => renderAction(action, 'root'))}
      </Menu>
      <Menu
        open={!!subMenu}
        anchorEl={subMenu?.anchorEl ?? null}
        onClose={closeSubMenu}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={event => event.stopPropagation()}
        slotProps={HOST_CONTEXT_MENU_SLOT_PROPS}
      >
        {subMenuActions.map(action => renderAction(action, 'submenu'))}
      </Menu>
    </>
  )
}
