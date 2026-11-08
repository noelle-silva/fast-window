import * as React from 'react'
import {
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
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
  onReorderEntries: (activeKey: string, overKey: string) => void
  onCollectEntry: (entry: PromptLayerEntry) => void
  onMoveEntryToFolder: (entry: PromptLayerEntry) => void
  onRenameFolder: (folder: PromptFolder) => void
  onDeleteFolder: (folder: PromptFolder) => void
}

type ContextMenuState = { x: number; y: number; entry: PromptLayerEntry }

// 行样式 = 共用行常量 + 拖拽态，与实体列表的组装方式保持一致。
function sortableRowSx(drag: SortableItemRenderArgs | null): SxProps<Theme> {
  const parts: unknown[] = [SOFT_POPOVER_ITEM_SX]
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
  if (!status.isDragging) return '提示：按住 Ctrl 拖动，可移动任意层级'
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
    onReorderEntries,
    onCollectEntry,
    onMoveEntryToFolder,
    onRenameFolder,
    onDeleteFolder,
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
          width: 260,
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
        </Stack>

        <CustomScrollArea hostSx={{ flex: 1, minHeight: 0 }} scrollSx={{ height: '100%' }} axis="y">
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
                                  primaryTypographyProps={{ fontSize: 13, fontWeight: 700 }}
                                />
                              </>
                            ) : (
                              <>
                                <DescriptionOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                                <ListItemText
                                  primary={entry.prompt.name}
                                  secondary={entry.prompt.description || undefined}
                                  primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }}
                                  secondaryTypographyProps={{ fontSize: 11, noWrap: true }}
                                />
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
