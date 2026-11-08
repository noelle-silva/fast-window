import * as React from 'react'
import { List, ListItemButton, ListItemText, Paper, Popper, Typography } from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import { SortableDropTarget, useSortableDragState, type SortableDropConfig } from '../components/SortableDnd'
import type { PromptFolderCrumb } from '../../domain/promptLibrary'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'

// 顶部面包屑：只表达「我现在站的这条路径」，从根层级一路到当前层。
// 悬停即展开，拖动时每一级都是落点，松手就搬到那一级。
// 这里不铺整棵收藏夹树：那条路径之外的岔路，从列表里的收藏夹行进入。

type PromptFolderCrumbsMenuProps = {
  currentFolderId: string
  crumbs: PromptFolderCrumb[]
  onNavigate: (folderId: string) => void
  /** 不传（搜索过滤中）时只为导航服务，不接收拖拽落点。 */
  drop?: SortableDropConfig | null
}

const hoverCloseDelayMs = 220

function dropRowSx(isDropCandidate: boolean, isDropTarget: boolean): Record<string, unknown> {
  if (isDropTarget) {
    return {
      bgcolor: 'var(--studio-primary)',
      color: '#fff',
      boxShadow: 'var(--studio-shadow-soft)',
      '&:hover': { bgcolor: 'var(--studio-primary)' },
      '& .MuiSvgIcon-root': { color: 'inherit' },
    }
  }
  if (isDropCandidate) {
    return {
      bgcolor: 'var(--studio-primary-soft)',
      outline: '1px dashed var(--studio-primary)',
      outlineOffset: -1,
    }
  }
  return {}
}

export function PromptFolderCrumbsMenu(props: PromptFolderCrumbsMenuProps) {
  const { currentFolderId, crumbs, onNavigate, drop = null } = props
  const dragState = useSortableDragState()
  const isDropMode = dragState?.mode === 'drop'
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null)
  // 拖动悬停展开只服务「放置」：Ctrl 拖拽中指针压到面包屑上才展开。
  const [hoverOpen, setHoverOpen] = React.useState(false)
  const [pinnedOpen, setPinnedOpen] = React.useState(false)
  const closeTimerRef = React.useRef<number | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const hoverOpenRef = React.useRef(false)

  const open = Boolean(anchorEl) && (pinnedOpen || hoverOpen)
  const setTriggerRef = React.useCallback((node: HTMLElement | null) => setAnchorEl(node), [])
  const currentName = crumbs[crumbs.length - 1]?.name || '根层级'
  // 路径上除了当前层，还有哪些层可以落：根层时没有可落目标，提示换个入口。
  const hasOtherLayer = crumbs.some((crumb) => crumb.id !== currentFolderId)

  const applyHoverOpen = React.useCallback((next: boolean) => {
    if (hoverOpenRef.current === next) return
    hoverOpenRef.current = next
    setHoverOpen(next)
  }, [])

  const cancelClose = React.useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  // 收起是幂等的：指针移动每秒触发多次，已经在计时就不再重建计时器。
  const scheduleClose = React.useCallback(() => {
    if (closeTimerRef.current !== null) return
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      hoverOpenRef.current = false
      setHoverOpen(false)
      setPinnedOpen(false)
    }, hoverCloseDelayMs)
  }, [])

  React.useEffect(() => cancelClose, [cancelClose])

  const togglePinned = React.useCallback(() => {
    cancelClose()
    const next = !pinnedOpen
    setPinnedOpen(next)
    if (!next) applyHoverOpen(false)
  }, [applyHoverOpen, cancelClose, pinnedOpen])

  const navigate = React.useCallback(
    (folderId: string) => {
      setPinnedOpen(false)
      applyHoverOpen(false)
      onNavigate(folderId)
    },
    [applyHoverOpen, onNavigate],
  )

  // 展开的唯一触发：拖动放置模式下，指针压到面包屑或已展开的面板上。
  // 平时鼠标扫过不会展开，避免误开挡住列表。
  React.useEffect(() => {
    if (!isDropMode) {
      applyHoverOpen(false)
      return
    }
    const within = (node: HTMLElement | null, x: number, y: number) => {
      if (!node) return false
      const rect = node.getBoundingClientRect()
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (within(anchorEl, event.clientX, event.clientY) || within(panelRef.current, event.clientX, event.clientY)) {
        cancelClose()
        applyHoverOpen(true)
        return
      }
      scheduleClose()
    }
    window.addEventListener('pointermove', handlePointerMove, true)
    return () => window.removeEventListener('pointermove', handlePointerMove, true)
  }, [anchorEl, applyHoverOpen, cancelClose, isDropMode, scheduleClose])

  // 点击展开（非拖拽）时，点面板外部收起：Popper 不接管焦点，需要自己判定。
  React.useEffect(() => {
    if (!pinnedOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (anchorEl?.contains(target) || panelRef.current?.contains(target))) return
      setPinnedOpen(false)
      applyHoverOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => window.removeEventListener('pointerdown', handlePointerDown, true)
  }, [anchorEl, applyHoverOpen, pinnedOpen])

  return (
    <>
      <ListItemButton
        ref={setTriggerRef}
        dense
        onClick={togglePinned}
        aria-haspopup="menu"
        aria-expanded={open}
        sx={{
          flex: 1,
          minWidth: 0,
          borderRadius: 1,
          px: 1,
          py: 0.5,
          bgcolor: 'var(--studio-field)',
          '&:hover': { bgcolor: 'var(--studio-field-hover)' },
        }}
      >
        <ListItemText
          primary={currentName}
          primaryTypographyProps={{ fontSize: 13, fontWeight: 700, noWrap: true }}
        />
        <ArrowDropDownIcon fontSize="small" sx={{ color: 'var(--studio-text-secondary)' }} />
      </ListItemButton>

      {/* 用 Popper 而不是 Modal 系弹层：悬停展开时全屏容器会盖住触发器，
          导致 mouseleave 抖动；Popper 不拦截其它区域的指针。 */}
      <Popper
        open={open}
        anchorEl={anchorEl}
        placement="bottom-start"
        transition={false}
        modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}
        sx={{ zIndex: (theme) => theme.zIndex.modal }}
      >
        <Paper
          ref={panelRef}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          sx={{ width: 268, borderRadius: 2, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 380 }}
        >
          <Typography variant="caption" sx={{ px: 1.25, pt: 1, color: 'text.secondary' }}>
            {isDropMode
              ? hasOtherLayer
                ? '松手落到高亮的这一层'
                : '已在根层级，可移入列表里的收藏夹'
              : '当前所在的收藏夹路径'}
          </Typography>
          <List dense disablePadding sx={[SOFT_POPOVER_LIST_SX, { overflowY: 'auto' }]}>
            {crumbs.map((crumb) => (
              <SortableDropTarget
                key={crumb.id || 'root'}
                id={`prompt-path:${crumb.id || 'root'}`}
                targetId={crumb.id}
                disabled={!drop}
                dropPriority={1}
              >
                {(place) => {
                  const isCurrent = crumb.id === currentFolderId
                  return (
                    <ListItemButton
                      ref={place.setNodeRef}
                      dense
                      selected={isCurrent && !place.isDropTarget}
                      onClick={(event) => {
                        if (place.shouldSuppressClick()) {
                          event.preventDefault()
                          return
                        }
                        navigate(crumb.id)
                      }}
                      sx={[SOFT_POPOVER_ITEM_SX, dropRowSx(place.isDropCandidate, place.isDropTarget)]}
                    >
                      <FolderOutlinedIcon
                        fontSize="small"
                        sx={{ mr: 1, color: place.isDropTarget ? 'inherit' : 'var(--studio-secondary)' }}
                      />
                      <ListItemText
                        primary={crumb.name}
                        primaryTypographyProps={{ fontSize: 13, fontWeight: isCurrent ? 700 : 600, noWrap: true }}
                      />
                      {isCurrent ? (
                        <Typography variant="caption" sx={{ color: 'inherit', opacity: 0.7 }}>
                          当前
                        </Typography>
                      ) : null}
                    </ListItemButton>
                  )
                }}
              </SortableDropTarget>
            ))}
          </List>
        </Paper>
      </Popper>

    </>
  )
}
