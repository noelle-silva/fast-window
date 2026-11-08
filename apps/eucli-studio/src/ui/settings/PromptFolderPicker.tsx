import * as React from 'react'
import {
  Box,
  Button,
  Checkbox,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import SearchIcon from '@mui/icons-material/Search'
import { DependableDialog } from '../components/DependableOverlay'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'
import type { PromptFolder } from '../../domain/promptLibrary'

// 收藏夹选择窗：一棵树、多选勾选，点条目切换、点保存才生效。
// 顶部搜索实时过滤，底部只有取消与保存；尺寸固定，不随内容变化。

const FILLED_SECONDARY_SX = {
  bgcolor: 'var(--studio-field)',
  color: 'var(--studio-text-primary)',
  boxShadow: 'var(--studio-shadow-soft)',
  '&:hover': { bgcolor: 'var(--studio-field-hover)', boxShadow: 'var(--studio-shadow-soft)' },
}

type PromptFolderPickerProps = {
  open: boolean
  folders: PromptFolder[]
  /** 根级顺序由收藏夹库给出，组件不自行推断。 */
  rootFolderIds: string[]
  /** 打开时已经处于勾选状态的收藏夹。 */
  initialSelectedIds: string[]
  /** 不可选的目标（例如正在移动的收藏夹及其全部后代）。 */
  excludedIds?: string[]
  onClose: () => void
  onSave: (selectedFolderIds: string[]) => void
}

type TreeRow = { folder: PromptFolder; depth: number }

function buildRows(folders: PromptFolder[], rootFolderIds: string[], keyword: string, excluded: Set<string>): TreeRow[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const parentOf = new Map<string, string>()
  for (const folder of folders) {
    for (const childId of folder.folderIds) parentOf.set(childId, folder.id)
  }

  // 搜索时保留「自身或后代命中」的节点与它们的祖先链，树形不被压平。
  const visible: Set<string> | null = keyword
    ? (() => {
        const matched = new Set<string>()
        for (const folder of folders) {
          if (!folder.name.includes(keyword)) continue
          let current: string | undefined = folder.id
          while (current) {
            matched.add(current)
            current = parentOf.get(current)
          }
        }
        return matched
      })()
    : null

  const rows: TreeRow[] = []
  // 收藏夹可被多个上级收录：同一节点只展示一次，避免重复与环导致的展开。
  const visited = new Set<string>()
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      if (excluded.has(id) || visited.has(id)) continue
      visited.add(id)
      const folder = byId.get(id)
      if (!folder) continue
      if (!visible || visible.has(id)) rows.push({ folder, depth })
      walk(folder.folderIds, depth + 1)
    }
  }
  walk(rootFolderIds, 0)
  return rows
}

export function PromptFolderPicker(props: PromptFolderPickerProps) {
  const { open, folders, rootFolderIds, initialSelectedIds, excludedIds = [], onClose, onSave } = props
  const [keyword, setKeyword] = React.useState('')
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])

  // 每次打开都从「当前已收藏的位置」重新开始勾选。
  React.useEffect(() => {
    if (!open) return
    setKeyword('')
    setSelectedIds(initialSelectedIds.slice())
  }, [open, initialSelectedIds])

  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const rows = React.useMemo(
    () => buildRows(folders, rootFolderIds, String(keyword ?? '').trim(), new Set(excludedIds)),
    [excludedIds, folders, rootFolderIds, keyword],
  )

  const toggle = (folderId: string) => {
    setSelectedIds((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId],
    )
  }

  return (
    <DependableDialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{ sx: { width: 660, height: 620, borderRadius: 3 } }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box sx={{ p: 1.5, pb: 1 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="搜索收藏夹"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
          />
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1 }}>
          {rows.length ? (
            <List dense disablePadding sx={SOFT_POPOVER_LIST_SX}>
              {rows.map((row) => {
                const checked = selected.has(row.folder.id)
                return (
                  <ListItemButton
                    key={row.folder.id}
                    dense
                    onClick={() => toggle(row.folder.id)}
                    sx={[SOFT_POPOVER_ITEM_SX, { pl: 1 + row.depth * 2 }]}
                  >
                    <Checkbox checked={checked} size="small" edge="start" tabIndex={-1} disableRipple sx={{ mr: 0.5 }} />
                    <FolderOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'var(--studio-secondary)' }} />
                    <ListItemText primary={row.folder.name} primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }} />
                  </ListItemButton>
                )
              })}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2 }}>
              {folders.length ? '没有匹配的收藏夹' : '还没有收藏夹，先新建一个'}
            </Typography>
          )}
        </Box>

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <Button variant="contained" disableElevation onClick={onClose} sx={FILLED_SECONDARY_SX}>
            取消
          </Button>
          <Button variant="contained" disableElevation onClick={() => onSave(selectedIds)}>
            保存
          </Button>
        </Stack>
      </Box>
    </DependableDialog>
  )
}
