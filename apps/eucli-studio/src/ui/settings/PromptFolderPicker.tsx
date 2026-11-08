import * as React from 'react'
import { Box, List, ListItemButton, ListItemText, TextField, Typography } from '@mui/material'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import { DependableDialog } from '../components/DependableOverlay'
import { SOFT_POPOVER_ITEM_SX, SOFT_POPOVER_LIST_SX } from '../softPopoverStyles'
import type { PromptFolder } from '../../domain/promptLibrary'

// 收藏到收藏夹的模态窗：没有顶部栏与底部栏，顶部是实时过滤的搜索框，下面是收藏夹树。
// 点某个收藏夹即选定并关闭。

type PromptFolderPickerProps = {
  open: boolean
  folders: PromptFolder[]
  /** 根级顺序由收藏夹库给出，组件不自行推断。 */
  rootFolderIds: string[]
  /** 不可选的目标（例如正在移动的收藏夹及其全部后代）。 */
  excludedIds?: string[]
  onClose: () => void
  onPick: (folderId: string) => void
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
  // 收藏夹可被多个上级收录，同一节点只展示一次，避免重复与环导致的展开。
  const visited = new Set<string>()
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      // 被排除的节点连同它的子树一起跳过。
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
  const { open, folders, rootFolderIds, excludedIds = [], onClose, onPick } = props
  const [keyword, setKeyword] = React.useState('')

  React.useEffect(() => {
    if (!open) setKeyword('')
  }, [open])

  const rows = React.useMemo(
    () => buildRows(folders, rootFolderIds, String(keyword ?? '').trim(), new Set(excludedIds)),
    [excludedIds, folders, rootFolderIds, keyword],
  )

  return (
    <DependableDialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <TextField
          autoFocus
          size="small"
          placeholder="搜索收藏夹"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Box sx={{ maxHeight: 360, minHeight: 120, overflowY: 'auto' }}>
          {rows.length ? (
            <List dense disablePadding sx={SOFT_POPOVER_LIST_SX}>
              {rows.map((row) => (
                <ListItemButton
                  key={row.folder.id}
                  dense
                  onClick={() => onPick(row.folder.id)}
                  sx={[SOFT_POPOVER_ITEM_SX, { pl: 1 + row.depth * 2 }]}
                >
                  <FolderOutlinedIcon fontSize="small" sx={{ mr: 1, color: 'var(--studio-secondary)' }} />
                  <ListItemText primary={row.folder.name} primaryTypographyProps={{ fontSize: 13, fontWeight: 600 }} />
                </ListItemButton>
              ))}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1.5 }}>
              {folders.length ? '没有匹配的收藏夹' : '还没有收藏夹，先新建一个'}
            </Typography>
          )}
        </Box>
      </Box>
    </DependableDialog>
  )
}
