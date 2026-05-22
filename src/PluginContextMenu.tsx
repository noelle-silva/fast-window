import { useCallback, useEffect, useState } from 'react'
import { Menu, MenuItem } from '@mui/material'
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
  const [subMenuAnchor, setSubMenuAnchor] = useState<HTMLElement | null>(null)
  const [subMenuActions, setSubMenuActions] = useState<ContextMenuAction[]>([])

  const closeAll = useCallback(() => {
    setSubMenuAnchor(null)
    setSubMenuActions([])
    onClose()
  }, [onClose])

  const closeSubMenu = useCallback(() => {
    setSubMenuAnchor(null)
    setSubMenuActions([])
  }, [])

  useCloseOnOutsidePrimaryPointer(open || !!subMenuAnchor, closeAll)

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
          if (action.disabled) return
          setSubMenuAnchor(event.currentTarget)
          setSubMenuActions(action.children ?? [])
        }}
        onClick={event => {
          event.stopPropagation()
          if (hasChildren) {
            if (action.disabled) return
            setSubMenuAnchor(event.currentTarget)
            setSubMenuActions(action.children ?? [])
            return
          }
          closeAll()
          action.onSelect?.()
        }}
      >
        <span style={{ flex: 1 }}>{action.label}</span>
        {hasChildren ? <span style={{ marginLeft: 18, opacity: 0.64 }}>{'>'}</span> : null}
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
        open={!!subMenuAnchor}
        anchorEl={subMenuAnchor}
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
