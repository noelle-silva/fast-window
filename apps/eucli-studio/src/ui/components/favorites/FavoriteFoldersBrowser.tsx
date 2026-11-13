import * as React from 'react'
import { Box, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded'
import { arrayMove } from '@dnd-kit/sortable'
import { colorMixVar } from '../../colorThemeStyles'
import type { FavoriteFolderLevel, FavoriteFolderLevelEntry, FavoriteFolderLevelFolder } from '../../../domain/favoriteFolderLevel'
import { sessionSourceLabel } from '../../../domain/sessionSourceLabel'
import { ChatSessionRunIndicator, type ChatSessionRunIndicatorKind } from '../ChatSessionRunIndicator'
import { EntityAvatar } from '../avatar/EntityAvatar'
import { SortableItem, SortableRoot, SortableSection, type SortableItemRenderArgs } from '../SortableDnd'

// 会话收藏夹的层级浏览：照搬 hypercortex 收藏夹侧边栏的形态——
// 不展开收起，点收藏夹直接进入下一层；返回按钮落在分类自己的工具行最左侧。
// 行样式沿用同一套节奏：36 高、4 点圆角、图标 + 单行标题、悬停与选中用主色淡底。
// 拖拽：默认同层排序；按住 Ctrl 拖动切到放置模式，悬停收藏夹松手把会话移进去。
// 点击：普通点击打开会话；按住 Ctrl / Cmd 点击把这一条直接放进工作桌面（与会话列表同一手感）。
const ROW_HEIGHT = 36
const ROW_RADIUS = 1
const ICON_SIZE = 22

const FOLDER_PREFIX = 'folder:'
const CHAT_PREFIX = 'chat:'

const LIST_SX = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': { width: 0, height: 0 },
  px: 0.5,
  py: 0.75,
  display: 'flex',
  flexDirection: 'column',
  gap: 0.25,
}

function folderItemId(folderId: string) {
  return `${FOLDER_PREFIX}${folderId}`
}

function chatItemId(refKey: string) {
  return `${CHAT_PREFIX}${refKey}`
}

export type FavoriteFoldersBrowserProps = {
  level: FavoriteFolderLevel
  /** 能否返回上一层级：来路为空时为 false，按钮置灰。 */
  canGoBack: boolean
  onBack: () => void
  onCreateFolder: () => void
  onOpenRef: (ref: FavoriteFolderLevelEntry) => void
  onRefContextMenu: (event: React.MouseEvent, ref: FavoriteFolderLevelEntry) => void
  /** 子收藏夹的右键：菜单本体与弹窗同源，这里只把「这一个收藏夹」交回去。 */
  onFolderContextMenu: (event: React.MouseEvent, folder: FavoriteFolderLevelFolder) => void
  onNavigate: (folderId: string) => void
  onReorderFolders: (orderedFolderIds: string[]) => void
  onReorderRefs: (orderedRefKeys: string[]) => void
  onMoveRef: (refKey: string, targetFolderId: string) => void
  /** 失效条目的手动清理：只摘掉这一条引用。 */
  onRemoveRef: (refKey: string) => void
  /** 会话条目进工作桌面：右键菜单之外，Ctrl / Cmd 点击也能直接放进去。 */
  onAddToDesk: (entry: FavoriteFolderLevelEntry) => void
  /** 悬停工作区条目时，图标临时换成所属角色（设置页可关）。 */
  hoverShowsRoleIcon: boolean
}

function RowShell(props: {
  ariaLabel: string
  active?: boolean
  dropTarget?: boolean
  sortable?: SortableItemRenderArgs
  /** 行被激活；withModifier 表示同时按住了 Ctrl / Cmd（会话行用它走「放进工作桌面」）。 */
  onActivate: (withModifier: boolean) => void
  onContextMenu?: (event: React.MouseEvent) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children: React.ReactNode
}) {
  const {
    ariaLabel,
    active = false,
    dropTarget = false,
    sortable,
    onActivate,
    onContextMenu,
    onMouseEnter,
    onMouseLeave,
    children,
  } = props
  const dragging = !!sortable?.isDragging
  return (
    <Box
      ref={sortable?.setNodeRef as any}
      {...(sortable?.handleProps || {})}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-current={active ? 'true' : undefined}
      style={sortable?.style}
      onClick={(event) => {
        if (sortable?.shouldSuppressClick()) return
        onActivate(event.ctrlKey || event.metaKey)
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onActivate(false)
      }}
      sx={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        px: 0.75,
        minHeight: ROW_HEIGHT,
        py: 0.5,
        boxSizing: 'border-box',
        borderRadius: ROW_RADIUS,
        userSelect: 'none',
        outline: 'none',
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        opacity: dragging ? 0.72 : 1,
        zIndex: dragging ? 2 : undefined,
        bgcolor: dropTarget || active ? colorMixVar('--studio-primary', 10) : 'transparent',
        boxShadow: dropTarget ? `inset 0 0 0 2px ${colorMixVar('--studio-primary', 70)}` : 'none',
        '&:hover': { bgcolor: colorMixVar('--studio-primary', dropTarget || active ? 14 : 6) },
        '&:focus-visible': { boxShadow: '0 10px 24px rgba(15,23,42,.14)' },
      }}
    >
      {children}
    </Box>
  )
}

function FolderRow(props: {
  folder: FavoriteFolderLevelFolder
  sortable: SortableItemRenderArgs
  onNavigate: () => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const { folder, sortable, onNavigate, onContextMenu } = props
  return (
    <RowShell
      ariaLabel={folder.name}
      dropTarget={sortable.isDropTarget}
      sortable={sortable}
      onActivate={() => onNavigate()}
      onContextMenu={onContextMenu}
    >
      <Box
        sx={{
          width: ICON_SIZE,
          height: ICON_SIZE,
          flex: '0 0 auto',
          borderRadius: 0.75,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'primary.main',
          bgcolor: colorMixVar('--studio-primary', 10),
        }}
      >
        <FolderOutlinedIcon sx={{ fontSize: 16 }} />
      </Box>
      <Typography
        noWrap
        sx={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.2, fontWeight: 600, color: 'text.secondary' }}
      >
        {folder.name}
      </Typography>
      <ChevronRightRoundedIcon sx={{ fontSize: 16, flexShrink: 0, color: 'text.disabled' }} />
    </RowShell>
  )
}

function ChatRow(props: {
  entry: FavoriteFolderLevelEntry
  hoverShowsRoleIcon: boolean
  sortable: SortableItemRenderArgs
  onOpen: () => void
  onAddToDesk: () => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const { entry, hoverShowsRoleIcon, sortable, onOpen, onAddToDesk, onContextMenu } = props
  const [hovered, setHovered] = React.useState(false)
  const lost = entry.status === 'missing'
  // 悬停换图标只作用于工作区来源；未加载与丢失都用目标自身的图标。
  const swapToRole = hoverShowsRoleIcon && !lost && entry.targetKind === 'workspace' && hovered
  const targetLine = sessionSourceLabel(entry)

  return (
    <RowShell
      ariaLabel={entry.title}
      active={entry.selected}
      sortable={sortable}
      onActivate={(withModifier) => {
        // Ctrl / Cmd 直接点：把这一条放进工作桌面，与会话列表那边同一个手感。
        // 失效条目不参与：目标都没了，桌面也不需要它。
        if (withModifier && !lost) {
          onAddToDesk()
          return
        }
        onOpen()
      }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {lost ? (
        <Box
          sx={{
            width: ICON_SIZE,
            height: ICON_SIZE,
            flex: '0 0 auto',
            borderRadius: 0.75,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.disabled',
            bgcolor: colorMixVar('--studio-primary', 6),
          }}
        >
          <LinkOffRoundedIcon sx={{ fontSize: 15 }} />
        </Box>
      ) : (
        <EntityAvatar
          kind={swapToRole ? 'role' : entry.targetKind}
          image={swapToRole ? entry.roleAvatarImage : entry.targetImage}
          size={ICON_SIZE}
        />
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.125 }}>
        <Typography
          noWrap
          sx={{
            fontSize: 12,
            lineHeight: 1.2,
            fontWeight: entry.selected ? 900 : 600,
            color: lost ? 'text.disabled' : entry.selected ? 'text.primary' : 'text.secondary',
          }}
        >
          {entry.title}
        </Typography>
        <Typography noWrap sx={{ fontSize: 10.5, lineHeight: 1.2, color: 'text.disabled' }}>
          {targetLine}
        </Typography>
      </Box>
      {entry.runningKind ? (
        <ChatSessionRunIndicator kind={entry.runningKind as ChatSessionRunIndicatorKind} />
      ) : null}
    </RowShell>
  )
}

export function FavoriteFoldersBrowser(props: FavoriteFoldersBrowserProps) {
  const {
    level,
    canGoBack,
    onBack,
    onCreateFolder,
    onOpenRef,
    onRefContextMenu,
    onFolderContextMenu,
    onNavigate,
    onReorderFolders,
    onReorderRefs,
    onMoveRef,
    onRemoveRef,
    onAddToDesk,
    hoverShowsRoleIcon,
  } = props

  const [missingMenu, setMissingMenu] = React.useState<{ x: number; y: number; key: string } | null>(null)

  const folders = level.folders
  const refs = level.refs
  const folderIds = React.useMemo(() => folders.map((folder) => folderItemId(folder.id)), [folders])
  const refIds = React.useMemo(() => refs.map((ref) => chatItemId(ref.key)), [refs])

  const handleMove = React.useCallback(
    (activeId: string, overId: string) => {
      if (activeId.startsWith(FOLDER_PREFIX) && overId.startsWith(FOLDER_PREFIX)) {
        const ids = folders.map((folder) => folderItemId(folder.id))
        const from = ids.indexOf(activeId)
        const to = ids.indexOf(overId)
        if (from < 0 || to < 0 || from === to) return
        onReorderFolders(arrayMove(ids, from, to).map((id) => id.slice(FOLDER_PREFIX.length)))
        return
      }
      if (activeId.startsWith(CHAT_PREFIX) && overId.startsWith(CHAT_PREFIX)) {
        const ids = refs.map((ref) => chatItemId(ref.key))
        const from = ids.indexOf(activeId)
        const to = ids.indexOf(overId)
        if (from < 0 || to < 0 || from === to) return
        onReorderRefs(arrayMove(ids, from, to).map((id) => id.slice(CHAT_PREFIX.length)))
      }
    },
    [folders, refs, onReorderFolders, onReorderRefs],
  )

  const drop = React.useMemo(
    () => ({
      canDrop: (activeId: string, targetId: string) =>
        activeId.startsWith(CHAT_PREFIX) && targetId.startsWith(FOLDER_PREFIX),
      onDrop: (activeId: string, targetId: string) => {
        onMoveRef(activeId.slice(CHAT_PREFIX.length), targetId.slice(FOLDER_PREFIX.length))
      },
    }),
    [onMoveRef],
  )

  const empty = !folders.length && !refs.length

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, flexShrink: 0 }}>
        <Tooltip title="返回上一层级">
          <span>
            <IconButton size="small" aria-label="返回上一层级" disabled={!canGoBack} onClick={onBack}>
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0 }} />
        <Tooltip title="新建收藏夹">
          <IconButton size="small" aria-label="新建收藏夹" onClick={onCreateFolder}>
            <CreateNewFolderRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={LIST_SX}>
        {empty ? (
          <Typography sx={{ px: 0.75, py: 0.5, fontSize: 12, color: 'text.disabled' }}>这个收藏夹还是空的</Typography>
        ) : null}

        <SortableRoot onMove={handleMove} drop={drop}>
          {/* 收藏夹与会话各自成段：两类实体的顺序分别落盘，跨类拖动不会出现「换了位又弹回」。 */}
          <SortableSection items={folderIds}>
            {folders.map((folder) => (
              <SortableItem key={folderItemId(folder.id)} id={folderItemId(folder.id)}>
                {(sortable) => (
                  <FolderRow
                    folder={folder}
                    sortable={sortable}
                    onNavigate={() => onNavigate(folder.id)}
                    onContextMenu={(event) => onFolderContextMenu(event, folder)}
                  />
                )}
              </SortableItem>
            ))}
          </SortableSection>

          <SortableSection items={refIds}>
            {refs.map((entry) => (
              <SortableItem key={chatItemId(entry.key)} id={chatItemId(entry.key)}>
                {(sortable) => (
                  <ChatRow
                    entry={entry}
                    hoverShowsRoleIcon={hoverShowsRoleIcon}
                    sortable={sortable}
                    onOpen={() => onOpenRef(entry)}
                    onAddToDesk={() => onAddToDesk(entry)}
                    onContextMenu={(event) => {
                      // 已在内存的走会话菜单；还没加载的也给「删除这条收藏」，真失效的条目只能靠它清理。
                      if (entry.status === 'loaded') {
                        onRefContextMenu(event, entry)
                        return
                      }
                      event.preventDefault()
                      setMissingMenu({ x: event.clientX, y: event.clientY, key: entry.key })
                    }}
                  />
                )}
              </SortableItem>
            ))}
          </SortableSection>
        </SortableRoot>
      </Box>

      <Menu
        open={!!missingMenu}
        onClose={() => setMissingMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={missingMenu ? { top: missingMenu.y, left: missingMenu.x } : undefined}
      >
        <MenuItem
          onClick={() => {
            const key = missingMenu?.key
            setMissingMenu(null)
            if (key) onRemoveRef(key)
          }}
          sx={{ fontSize: 12 }}
        >
          删除这条收藏
        </MenuItem>
      </Menu>
    </>
  )
}
