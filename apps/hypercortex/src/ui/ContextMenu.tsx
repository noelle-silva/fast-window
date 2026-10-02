import * as React from 'react'
import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import { menuPaperSx } from './pluginUiStyles'
import { useWorkspaceVisible } from './workspaceVisibility'

// 统一右键菜单：数据驱动、无展开动画、任意外部指针按下即失焦关闭。
// 菜单根节点不拦截指针（paper 才可交互），因此右键到别处时先关闭本菜单，目标处的右键处理再开新菜单。

const CONTEXT_MENU_PAPER_ATTR = 'data-hc-context-menu-paper'

function suppressNativeContextMenu(event: React.MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

export type ContextMenuLeaf = {
  id: string
  label: string
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
}

export type ContextMenuAction = ContextMenuLeaf & {
  /** 子菜单动作（仅一层）。 */
  children?: ContextMenuLeaf[]
}

export type ContextMenuCustom = {
  id: string
  render: () => React.ReactNode
}

export type ContextMenuItem = ContextMenuAction | ContextMenuCustom

function isCustomItem(item: ContextMenuItem): item is ContextMenuCustom {
  return typeof (item as ContextMenuCustom).render === 'function'
}

function useDismissOnOutsidePointer(active: boolean, onClose: () => void) {
  // 常驻监听器：不随菜单开合重建。左键外部按下时置位吞噬标志，
  // 随后的 click 被吞掉，避免穿透触发下层元素。
  // 若把 click 监听器随 active 重建，onClose 引起的重渲染会在 click 派发前就把它清掉，导致吞噬失效。
  const activeRef = React.useRef(active)
  const onCloseRef = React.useRef(onClose)
  const swallowClickRef = React.useRef(false)
  activeRef.current = active
  onCloseRef.current = onClose

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // 每次按下都先重置，避免上一轮未派发的 click 残留导致误吞。
      swallowClickRef.current = false
      if (!activeRef.current) return
      const target = event.target
      if (target instanceof Element && target.closest(`[${CONTEXT_MENU_PAPER_ATTR}="true"]`)) return
      // 左键：吞掉这次交互，避免穿透触发下层元素的点击；右键：放行以便目标处开新菜单。
      if (event.button === 0) {
        swallowClickRef.current = true
        event.preventDefault()
        event.stopPropagation()
      }
      onCloseRef.current()
    }
    const onClick = (event: MouseEvent) => {
      if (!swallowClickRef.current) return
      swallowClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])
}

export type ContextMenuProps = {
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu(props: ContextMenuProps): React.ReactNode {
  const { open, x, y, items, onClose } = props
  const workspaceVisible = useWorkspaceVisible()
  const [submenu, setSubmenu] = React.useState<{ parentId: string; anchorEl: HTMLElement } | null>(null)

  React.useEffect(() => {
    if (!open) setSubmenu(null)
  }, [open])

  React.useEffect(() => {
    setSubmenu(null)
  }, [x, y])

  useDismissOnOutsidePointer(open, onClose)

  const slotProps = React.useMemo(
    () => ({
      root: { sx: { pointerEvents: 'none' as const } },
      paper: {
        [CONTEXT_MENU_PAPER_ATTR]: 'true',
        onContextMenu: suppressNativeContextMenu,
        sx: { pointerEvents: 'auto' as const, ...menuPaperSx },
      },
    }),
    [],
  )

  const openSubmenu = React.useCallback((item: ContextMenuAction, anchorEl: HTMLElement) => {
    if (!item.children?.length) return
    setSubmenu({ parentId: item.id, anchorEl })
  }, [])

  const closeSubmenu = React.useCallback(() => setSubmenu(null), [])

  const submenuLeaves = React.useMemo<ContextMenuLeaf[]>(() => {
    if (!submenu) return []
    const parent = items.find(item => !isCustomItem(item) && item.id === submenu.parentId)
    return parent && !isCustomItem(parent) ? parent.children ?? [] : []
  }, [items, submenu])

  const renderLeaf = (leaf: ContextMenuLeaf) => (
    <MenuItem
      key={leaf.id}
      disabled={leaf.disabled}
      sx={leaf.danger ? { color: 'var(--hc-danger)' } : undefined}
      onClick={event => {
        event.stopPropagation()
        onClose()
        leaf.onSelect?.()
      }}
    >
      {leaf.icon ? <ListItemIcon sx={leaf.danger ? { color: 'inherit' } : undefined}>{leaf.icon}</ListItemIcon> : null}
      <ListItemText primary={leaf.label} />
    </MenuItem>
  )

  const renderItem = (item: ContextMenuItem) => {
    if (isCustomItem(item)) {
      return <React.Fragment key={item.id}>{item.render()}</React.Fragment>
    }
    const hasChildren = !!item.children?.length
    return (
      <MenuItem
        key={item.id}
        disabled={item.disabled}
        sx={item.danger ? { color: 'var(--hc-danger)' } : undefined}
        onMouseEnter={event => {
          if (hasChildren) openSubmenu(item, event.currentTarget)
          else closeSubmenu()
        }}
        onKeyDown={event => {
          if (hasChildren && event.key === 'ArrowRight') {
            event.preventDefault()
            openSubmenu(item, event.currentTarget)
          }
          if (!hasChildren && event.key === 'ArrowLeft') {
            event.preventDefault()
            closeSubmenu()
          }
        }}
        onClick={event => {
          event.stopPropagation()
          if (hasChildren) {
            openSubmenu(item, event.currentTarget)
            return
          }
          onClose()
          item.onSelect?.()
        }}
        aria-haspopup={hasChildren ? 'menu' : undefined}
        aria-expanded={submenu?.parentId === item.id}
      >
        {item.icon ? <ListItemIcon sx={item.danger ? { color: 'inherit' } : undefined}>{item.icon}</ListItemIcon> : null}
        <ListItemText primary={item.label} />
        {hasChildren ? <KeyboardArrowRightRoundedIcon fontSize="small" sx={{ ml: 2, opacity: 0.64 }} /> : null}
      </MenuItem>
    )
  }

  return (
    <>
      <Menu
        open={workspaceVisible && open}
        onClose={onClose}
        anchorReference="anchorPosition"
        anchorPosition={open ? { top: y, left: x } : { top: 0, left: 0 }}
        transitionDuration={0}
        slotProps={slotProps}
        onClick={event => event.stopPropagation()}
      >
        {items.map(renderItem)}
      </Menu>
      <Menu
        open={workspaceVisible && Boolean(submenu)}
        onClose={closeSubmenu}
        anchorEl={submenu?.anchorEl ?? null}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        transitionDuration={0}
        slotProps={slotProps}
        onClick={event => event.stopPropagation()}
      >
        {submenuLeaves.map(renderLeaf)}
      </Menu>
    </>
  )
}
