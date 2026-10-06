import * as React from 'react'
import { Menu } from '@mui/material'
import { menuPaperSx } from './pluginUiStyles'
import { useWorkspaceVisible } from './workspaceVisibility'

// 统一二级菜单机制：一级菜单悬停/点击某项即在其侧展开子菜单。
// 子菜单不交给 MUI 定位（MUI 会在视口边缘自动水平位移，导致子菜单翻到一级菜单上方遮挡），
// 改为手动摆放：优先右侧，放不下翻左侧；垂直与所悬停菜单项顶部对齐；整体夹在视口内；无展开动画。
// 右键菜单与「…」等任意一级菜单共用同一机制，保证表现完全一致。

/** 标记菜单纸面（一级与二级）：外部指针判定据此放行菜单内部的交互。 */
export const MENU_PAPER_ATTR = 'data-hc-context-menu-paper'
const SUBMENU_GAP = 2
const VIEWPORT_MARGIN = 8

function suppressNativeContextMenu(event: React.MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

export function useMenuSubmenu(parentOpen: boolean) {
  const workspaceVisible = useWorkspaceVisible()
  const [submenu, setSubmenu] = React.useState<{ parentId: string; anchorEl: HTMLElement } | null>(null)
  const rootPaperRef = React.useRef<HTMLElement | null>(null)
  const submenuPaperNodeRef = React.useRef<HTMLElement | null>(null)

  const submenuRef = React.useRef<{ parentId: string; anchorEl: HTMLElement } | null>(null)
  submenuRef.current = submenu

  // 一级菜单收起时子菜单一并收起，避免残留。
  React.useEffect(() => {
    if (!parentOpen) setSubmenu(null)
  }, [parentOpen])

  // 摆放：优先右侧，放不下则左侧，垂直与所悬停菜单项顶部对齐，并夹在视口内。
  const positionSubmenuNode = React.useCallback((paper: HTMLElement) => {
    const sub = submenuRef.current
    if (!sub) return
    const item = sub.anchorEl
    if (!item) return
    const itemRect = item.getBoundingClientRect()
    const rootRect = rootPaperRef.current?.getBoundingClientRect()
    const subWidth = paper.offsetWidth
    const subHeight = paper.offsetHeight
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const rootRight = rootRect ? rootRect.right : itemRect.right
    const rootLeft = rootRect ? rootRect.left : itemRect.left
    const fitsRight = viewportW - rootRight >= subWidth + SUBMENU_GAP + VIEWPORT_MARGIN
    const left = fitsRight ? rootRight + SUBMENU_GAP : rootLeft - subWidth - SUBMENU_GAP
    const clampedLeft = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportW - subWidth - VIEWPORT_MARGIN))
    const clampedTop = Math.max(VIEWPORT_MARGIN, Math.min(itemRect.top, viewportH - subHeight - VIEWPORT_MARGIN))
    paper.style.top = `${Math.round(clampedTop)}px`
    paper.style.left = `${Math.round(clampedLeft)}px`
  }, [])

  // 节点挂载即定位（回调 ref 不受 Portal 挂载时序影响）。
  const submenuPaperRef = React.useCallback(
    (node: HTMLElement | null) => {
      submenuPaperNodeRef.current = node
      if (node) positionSubmenuNode(node)
    },
    [positionSubmenuNode],
  )

  // 已打开时切换悬停项：节点复用不会触发回调 ref，这里补一次重定位。
  React.useLayoutEffect(() => {
    const paper = submenuPaperNodeRef.current
    if (paper) positionSubmenuNode(paper)
  }, [submenu, positionSubmenuNode])

  // 一级菜单 paper 的 slotProps：挂载引用供子菜单定位，并标记纸面、屏蔽原生右键菜单。
  const rootPaperSlotProps = React.useMemo(
    () => ({
      paper: {
        [MENU_PAPER_ATTR]: 'true',
        onContextMenu: suppressNativeContextMenu,
        ref: rootPaperRef,
        sx: { pointerEvents: 'auto' as const, ...menuPaperSx },
      },
    }),
    [],
  )

  const openSubmenu = React.useCallback((parentId: string, anchorEl: HTMLElement) => {
    setSubmenu({ parentId, anchorEl })
  }, [])

  const closeSubmenu = React.useCallback(() => setSubmenu(null), [])

  const submenuSlotProps = React.useMemo(
    () => ({
      root: { sx: { pointerEvents: 'none' as const } },
      paper: {
        [MENU_PAPER_ATTR]: 'true',
        onContextMenu: suppressNativeContextMenu,
        ref: submenuPaperRef,
        sx: { pointerEvents: 'auto' as const, position: 'fixed' as const, top: 0, left: 0, ...menuPaperSx },
      },
    }),
    [submenuPaperRef],
  )

  // 子菜单本体：无动画、手动定位、视口夹取、左右翻转；根节点不拦截指针，纸面可交互。
  const renderSubmenu = React.useCallback(
    (children: React.ReactNode) => (
      <Menu
        open={workspaceVisible && parentOpen && Boolean(submenu)}
        onClose={closeSubmenu}
        anchorReference="none"
        transitionDuration={0}
        slotProps={submenuSlotProps}
        onClick={event => event.stopPropagation()}
      >
        {children}
      </Menu>
    ),
    [closeSubmenu, parentOpen, submenu, submenuSlotProps, workspaceVisible],
  )

  return {
    /** 当前展开子菜单的一级项标识；未展开为空。 */
    submenuParentId: submenu?.parentId ?? null,
    openSubmenu,
    closeSubmenu,
    rootPaperSlotProps,
    renderSubmenu,
  }
}

export type MenuSubmenuController = ReturnType<typeof useMenuSubmenu>
