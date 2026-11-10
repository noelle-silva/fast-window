import * as React from 'react'
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AddIcon from '@mui/icons-material/Add'
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import InputIcon from '@mui/icons-material/Input'
import { type PromptFolder, type PromptFolderLayer, type PromptLayerEntry } from '../../domain/promptLibrary'
import { CustomScrollArea } from '../components/CustomScrollArea'
import {
  SortableDragStatus,
  type SortableDragStatusRenderArgs,
  type SortableDropConfig,
  type SortableItemRenderArgs,
  SortableItem,
  SortableRoot,
  SortableSection,
} from '../components/SortableDnd'
import { DependableMenu } from '../components/DependableOverlay'
import { PromptFolderCrumbsMenu } from './PromptFolderCrumbsMenu'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'

// 提示词仓库侧边栏：收藏夹与提示词同处一个混排列表，整行可拖拽。
// 不按 Ctrl 是排序；按住 Ctrl 拖拽是移动，收藏夹行与面包屑层级都是落点。
// 行内不再放功能按钮：收藏、重命名、删除都走右键菜单。
//
// 拖拽根包住整个侧边栏：面包屑下拉与底部提示都要读到同一份拖拽状态，
// 因此这里直接用 SortableRoot 组装，而不是只把列表包一层。

type PromptLibrarySidebarProps = {
  layer: PromptFolderLayer
  selectedPromptId: string
  loading: boolean
  /** 搜索过滤时禁用拖拽：顺序只按完整层提交，避免过滤后的顺序错位。 */
  dragDisabled?: boolean
  /** 拖拽落点配置；为空时整个侧边栏只有排序。 */
  drop?: SortableDropConfig | null
  onBack: () => void
  onNavigate: (folderId: string) => void
  onSelectPrompt: (promptId: string) => void
  /** 行内复制：只把正文写进剪贴板，不影响仓库里的任何事实。 */
  onCopyPrompt: (promptId: string) => void
  /** 行内填入：把正文插到输入框当前光标位置。没有可填的输入框时不给这个回调。 */
  onInsertPrompt?: (promptId: string) => void
  /** 这些条目挂着没保存的草稿：标题旁点一个黄点。 */
  dirtyPromptIds?: ReadonlySet<string>
  onReorderEntries: (activeKey: string, overKey: string) => void
  onCollectEntry: (entry: PromptLayerEntry) => void
  onMoveEntryToFolder: (entry: PromptLayerEntry) => void
  onRenameFolder: (folder: PromptFolder) => void
  onDeleteFolder: (folder: PromptFolder) => void
  /** 当前层搜索词：输入框常驻在顶部栏下面，不随列表滚动。 */
  search: string
  onSearchChange: (value: string) => void
  /** 顶部栏右侧的两个新建动作，只留图标。 */
  onCreatePrompt: () => void
  onCreateFolder: () => void
}

type ContextMenuState = { x: number; y: number; entry: PromptLayerEntry }

const NO_DIRTY_IDS: ReadonlySet<string> = new Set()

// 行内按钮与整行拖拽共用一个指针区域：按钮自己吃掉按下与冒泡，避免被整行拖走或误选中。
function stopPointerPropagation(event: React.PointerEvent) {
  event.stopPropagation()
}

// 填入按钮专用：按下时既不冒泡给拖拽，也不让按钮抢走输入框的焦点。
// 焦点一旦转移，输入框的选区就不可信，插入位置只能退回末尾。
function holdInputFocusPointer(event: React.PointerEvent) {
  event.stopPropagation()
  event.preventDefault()
}

// 行样式 = 共用行常量 + 拖拽态，与实体列表的组装方式保持一致。
function sortableRowSx(drag: SortableItemRenderArgs | null): SxProps<Theme> {
  // 圆角收到 10：行高 50 上下时 18 的圆角已经接近胶囊，这里要的是圆角矩形。
  const parts: unknown[] = [SOFT_POPOVER_ITEM_SX, { borderRadius: 1.25 }]
  if (drag) {
    parts.push({
      cursor: drag.isDragging ? 'grabbing' : 'grab',
      opacity: drag.isDragging ? 0.6 : 1,
      touchAction: 'pan-y',
    })
    parts.push(dropRowSx(drag))
  }
  return parts as SxProps<Theme>
}

// 放置态只在这里定义一次：目标行实心高亮，候选行浅底加虚线轮廓。
function dropRowSx(drag: Pick<SortableItemRenderArgs, 'isDropCandidate' | 'isDropTarget'>): Record<string, unknown> {
  if (drag.isDropTarget) {
    return {
      bgcolor: 'var(--studio-primary)',
      color: '#fff',
      boxShadow: 'var(--studio-shadow-soft)',
      '&:hover': { bgcolor: 'var(--studio-primary)' },
      '& .MuiListItemText-secondary': { color: 'rgba(255,255,255,.72)' },
      '& .MuiSvgIcon-root': { color: 'inherit' },
    }
  }
  if (drag.isDropCandidate) {
    return {
      bgcolor: 'var(--studio-primary-soft)',
      outline: '1px dashed var(--studio-primary)',
      outlineOffset: -1,
    }
  }
  return {}
}

function dragHintText(status: SortableDragStatusRenderArgs): string {
  if (!status.isDropMode) return '拖拽排序中；按住 Ctrl 切换为移动'
  return status.overTargetId === null ? '移到收藏夹或上方层级上松手' : '松手即移动到这一层'
}

export function PromptLibrarySidebar(props: PromptLibrarySidebarProps) {
  const {
    layer,
    selectedPromptId,
    loading,
    dragDisabled = false,
    drop = null,
    onBack,
    onNavigate,
    onSelectPrompt,
    onCopyPrompt,
    onInsertPrompt,
    dirtyPromptIds = NO_DIRTY_IDS,
    onReorderEntries,
    onCollectEntry,
    onMoveEntryToFolder,
    onRenameFolder,
    onDeleteFolder,
    search,
    onSearchChange,
    onCreatePrompt,
    onCreateFolder,
  } = props

  const [menu, setMenu] = React.useState<ContextMenuState | null>(null)
  const entryKeys = React.useMemo(() => layer.entries.map((entry) => entry.key), [layer.entries])
  const byKey = React.useMemo(() => new Map(layer.entries.map((entry) => [entry.key, entry])), [layer.entries])
  const dropConfig = dragDisabled ? null : drop

  const openMenu = (event: React.MouseEvent, entry: PromptLayerEntry) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, entry })
  }

  const closeMenu = () => setMenu(null)

  return (
    <SortableRoot onMove={onReorderEntries} drop={dropConfig}>
      <Box
        sx={{
          width: 325,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          borderRadius: 2,
          bgcolor: 'var(--studio-field)',
          p: 0.75,
        }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ px: 0.25, pb: 0.5 }}>
          <Tooltip title="返回上一级">
            <span>
              <IconButton size="small" onClick={onBack} disabled={layer.crumbs.length <= 1}>
                <ArrowBackIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <PromptFolderCrumbsMenu
              currentFolderId={layer.folderId}
              crumbs={layer.crumbs}
              onNavigate={onNavigate}
              drop={dropConfig}
            />
          </Box>
          <Tooltip title="新建提示词">
            <span>
              <IconButton size="small" aria-label="新建提示词" onClick={onCreatePrompt} disabled={loading}>
                <AddIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="新建收藏夹">
            <span>
              <IconButton size="small" aria-label="新建收藏夹" onClick={onCreateFolder} disabled={loading}>
                <CreateNewFolderRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {/* 搜索常驻在顶部栏下面，列表自己滚，它不跟着走。 */}
        <Box sx={{ px: 0.25, pb: 0.5 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="搜索当前层"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </Box>

        {/* 列表自己滚，但不画滚动条：滚动条只留给右侧编辑器，两块区域各滚各的。 */}
        <CustomScrollArea hostSx={{ flex: 1, minHeight: 0 }} scrollSx={{ height: '100%' }} axis="y" showThumbs={false}>
          <List dense disablePadding sx={SOFT_POPOVER_LIST_SX}>
            {entryKeys.length ? (
              <SortableSection items={entryKeys}>
                {entryKeys.map((key) => {
                  const entry = byKey.get(key)
                  if (!entry) return null
                  return (
                    <SortableItem
                      key={key}
                      id={key}
                      disabled={dragDisabled}
                      dropTargetId={entry.kind === 'folder' ? entry.id : undefined}
                    >
                      {(drag) => (
                        <Box ref={drag.setNodeRef} style={drag.style}>
                          <ListItemButton
                            dense
                            component="div"
                            {...drag.handleProps}
                            selected={entry.kind === 'prompt' && selectedPromptId === entry.prompt.id}
                            onClick={() => {
                              if (drag.shouldSuppressClick()) return
                              if (entry.kind === 'folder') onNavigate(entry.folder.id)
                              else onSelectPrompt(entry.prompt.id)
                            }}
                            onContextMenu={(event) => openMenu(event, entry)}
                            sx={sortableRowSx(drag)}
                          >
                            {entry.kind === 'folder' ? (
                              <>
                                <FolderOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'var(--studio-secondary)' }} />
                                <ListItemText
                                  primary={entry.folder.name}
                                  primaryTypographyProps={{ fontSize: 13, fontWeight: 700, noWrap: true }}
                                />
                              </>
                            ) : (
                              <>
                                <DescriptionOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                                <ListItemText
                                  primary={entry.prompt.name}
                                  secondary={entry.prompt.description || undefined}
                                  primaryTypographyProps={{ fontSize: 13, fontWeight: 600, noWrap: true }}
                                  secondaryTypographyProps={{ fontSize: 11, noWrap: true }}
                                />
                                {/* 有未保存的草稿：标题旁点一个黄点，关窗再回来还认得它。 */}
                                {dirtyPromptIds.has(entry.prompt.id) ? (
                                  <Box
                                    component="span"
                                    aria-label="有未保存的修改"
                                    sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0, ml: 0.5 }}
                                  />
                                ) : null}
                                {/* 复制按钮放在条目容器内部最右侧：不选中条目、不触发整行拖拽。 */}
                                <Tooltip title="复制内容">
                                  <IconButton
                                    size="small"
                                    aria-label="复制提示词内容"
                                    onPointerDown={stopPointerPropagation}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      onCopyPrompt(entry.prompt.id)
                                    }}
                                    sx={{ ml: 0.5, flexShrink: 0, color: 'var(--studio-text-secondary)' }}
                                  >
                                    <ContentCopyIcon sx={{ fontSize: 15 }} />
                                  </IconButton>
                                </Tooltip>
                                {/* 填入：不动剪贴板，直接写进输入框的光标处。没有输入框的地方不出现。 */}
                                {onInsertPrompt ? (
                                  <Tooltip title="填入输入框">
                                    <IconButton
                                      size="small"
                                      aria-label="填入提示词内容"
                                      onPointerDown={holdInputFocusPointer}
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        onInsertPrompt(entry.prompt.id)
                                      }}
                                      sx={{ ml: 0.5, flexShrink: 0, color: 'var(--studio-text-secondary)' }}
                                    >
                                      <InputIcon sx={{ fontSize: 15 }} />
                                    </IconButton>
                                  </Tooltip>
                                ) : null}
                              </>
                            )}
                          </ListItemButton>
                        </Box>
                      )}
                    </SortableItem>
                  )
                })}
              </SortableSection>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
                {loading ? '加载中…' : '这一层还是空的'}
              </Typography>
            )}
          </List>
        </CustomScrollArea>

        <SortableDragStatus>
          {(status) => (
            status.isDragging ? (
              <Typography
                variant="caption"
                sx={{
                  px: 0.5,
                  pt: 0.5,
                  color: status.isDropMode ? 'var(--studio-primary)' : 'var(--studio-text-secondary)',
                  fontWeight: status.isDropMode ? 700 : 400,
                }}
              >
                {dragHintText(status)}
              </Typography>
            ) : null
          )}
        </SortableDragStatus>

        <DependableMenu
          open={Boolean(menu)}
          onClose={closeMenu}
          anchorReference="anchorPosition"
          anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
          transitionDuration={0}
        >
          {/* 收藏到：提示词只加索引；收藏夹只有一个上级，落到目标夹即为挂载位置变化。 */}
          <MenuItemAction
            icon={<BookmarkAddOutlinedIcon fontSize="small" />}
            label="收藏到收藏夹"
            onSelect={() => {
              const entry = menu?.entry
              closeMenu()
              if (entry) onCollectEntry(entry)
            }}
          />
          {/* 移动到既加目标索引，也摘掉当前位置。 */}
          <MenuItemAction
            icon={<DriveFileMoveOutlinedIcon fontSize="small" />}
            label="移动到收藏夹"
            onSelect={() => {
              const entry = menu?.entry
              closeMenu()
              if (entry) onMoveEntryToFolder(entry)
            }}
          />
          {menu?.entry.kind === 'folder' ? (
            <MenuItemAction
              icon={<EditOutlinedIcon fontSize="small" />}
              label="重命名"
              onSelect={() => {
                const entry = menu.entry
                closeMenu()
                if (entry.kind === 'folder') onRenameFolder(entry.folder)
              }}
            />
          ) : null}
          {menu?.entry.kind === 'folder' ? (
            <MenuItemAction
              icon={<DeleteOutlineIcon fontSize="small" />}
              label="删除收藏夹"
              onSelect={() => {
                const entry = menu.entry
                closeMenu()
                if (entry.kind === 'folder') onDeleteFolder(entry.folder)
              }}
            />
          ) : null}
        </DependableMenu>
      </Box>
    </SortableRoot>
  )
}

function MenuItemAction(props: { icon: React.ReactNode; label: string; onSelect: () => void }) {
  return (
    <MenuItem onClick={props.onSelect} sx={{ gap: 1 }}>
      {props.icon}
      {props.label}
    </MenuItem>
  )
}
