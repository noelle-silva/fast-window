import * as React from 'react'
import {
  Box,
  FormControl,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
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
import { promptFolderParentId, type PromptFolder, type PromptFolderLayer, type PromptLayerEntry } from '../../domain/promptLibrary'
import { SortableList } from '../components/SortableList'
import { CustomScrollArea } from '../components/CustomScrollArea'
import type { SortableItemRenderArgs } from '../components/SortableDnd'
import { DependableMenu } from '../components/DependableOverlay'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'

// 提示词仓库侧边栏：收藏夹与提示词同处一个混排列表，整行可拖拽。
// 行内不再放功能按钮：收藏、重命名、删除都走右键菜单。

type PromptLibrarySidebarProps = {
  layer: PromptFolderLayer
  selectedPromptId: string
  loading: boolean
  /** 搜索过滤时禁用拖拽：顺序只按完整层提交，避免过滤后的顺序错位。 */
  dragDisabled?: boolean
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
  }
  return parts as SxProps<Theme>
}

export function PromptLibrarySidebar(props: PromptLibrarySidebarProps) {
  const {
    layer,
    selectedPromptId,
    loading,
    dragDisabled = false,
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

  const openMenu = (event: React.MouseEvent, entry: PromptLayerEntry) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, entry })
  }

  const closeMenu = () => setMenu(null)

  return (
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
        <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
          <Select
            value={layer.folderId}
            onChange={(event) => onNavigate(String(event.target.value))}
            displayEmpty
            // 面包屑：小圆角矩形、无描边，菜单直接出现。
            MenuProps={{ transitionDuration: 0 }}
            sx={{
              fontSize: 13,
              borderRadius: 1,
              bgcolor: 'var(--studio-field)',
              '& .MuiSelect-select': { py: 0.5 },
              '& .MuiOutlinedInput-notchedOutline': { border: 0, borderRadius: 1 },
              '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
            }}
          >
            {layer.crumbs.map((crumb) => (
              <MenuItem key={crumb.id || 'root'} value={crumb.id}>
                {crumb.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <CustomScrollArea hostSx={{ flex: 1, minHeight: 0 }} scrollSx={{ height: '100%' }} axis="y">
        <List dense disablePadding sx={SOFT_POPOVER_LIST_SX}>
          {entryKeys.length ? (
            <SortableList ids={entryKeys} onMove={onReorderEntries} disabled={dragDisabled}>
              {({ id, drag, shouldIgnoreClick }) => {
                const entry = byKey.get(id)
                if (!entry) return null
                if (entry.kind === 'folder') {
                  return (
                    <Box ref={drag.setNodeRef} style={drag.style}>
                      <ListItemButton
                        dense
                        component="div"
                        {...drag.handleProps}
                        onClick={() => {
                          if (shouldIgnoreClick()) return
                          onNavigate(entry.folder.id)
                        }}
                        onContextMenu={(event) => openMenu(event, entry)}
                        sx={sortableRowSx(drag)}
                      >
                        <FolderOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'var(--studio-secondary)' }} />
                        <ListItemText primary={entry.folder.name} primaryTypographyProps={{ fontSize: 13, fontWeight: 700 }} />
                      </ListItemButton>
                    </Box>
                  )
                }
                return (
                  <Box ref={drag.setNodeRef} style={drag.style}>
                    <ListItemButton
                      dense
                      component="div"
                      {...drag.handleProps}
                      selected={selectedPromptId === entry.prompt.id}
                      onClick={() => {
                        if (shouldIgnoreClick()) return
                        onSelectPrompt(entry.prompt.id)
                      }}
                      onContextMenu={(event) => openMenu(event, entry)}
                      sx={sortableRowSx(drag)}
                    >
                      <DescriptionOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                      <ListItemText
                        primary={entry.prompt.name}
                        secondary={entry.prompt.description || undefined}
                        primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }}
                        secondaryTypographyProps={{ fontSize: 11, noWrap: true }}
                      />
                    </ListItemButton>
                  </Box>
                )
              }}
            </SortableList>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
              {loading ? '加载中…' : '这一层还是空的'}
            </Typography>
          )}
        </List>
      </CustomScrollArea>

      <DependableMenu
        open={Boolean(menu)}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.y, left: menu.x } : undefined}
        transitionDuration={0}
      >
        {/* 收藏到：提示词只加索引；收藏夹只有一个上级，落到目标夹即为挂载位置变化。 */}
        <MenuItem
          onClick={() => {
            const entry = menu?.entry
            closeMenu()
            if (entry) onCollectEntry(entry)
          }}
          sx={{ gap: 1 }}
        >
          <BookmarkAddOutlinedIcon fontSize="small" />
          收藏到收藏夹
        </MenuItem>
        {/* 移动到既加目标索引，也摘掉当前位置。 */}
        <MenuItem
          onClick={() => {
            const entry = menu?.entry
            closeMenu()
            if (entry) onMoveEntryToFolder(entry)
          }}
          sx={{ gap: 1 }}
        >
          <DriveFileMoveOutlinedIcon fontSize="small" />
          移动到收藏夹
        </MenuItem>
        {menu?.entry.kind === 'folder' ? (
          <MenuItem
            onClick={() => {
              const entry = menu.entry
              closeMenu()
              if (entry.kind === 'folder') onRenameFolder(entry.folder)
            }}
            sx={{ gap: 1 }}
          >
            <EditOutlinedIcon fontSize="small" />
            重命名
          </MenuItem>
        ) : null}
        {menu?.entry.kind === 'folder' ? (
          <MenuItem
            onClick={() => {
              const entry = menu.entry
              closeMenu()
              if (entry.kind === 'folder') onDeleteFolder(entry.folder)
            }}
            sx={{ gap: 1 }}
          >
            <DeleteOutlineIcon fontSize="small" />
            删除收藏夹
          </MenuItem>
        ) : null}
      </DependableMenu>
    </Box>
  )
}
