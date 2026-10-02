import * as React from 'react'
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { getRefsByFolderId } from '../favorites'
import { buildFolderTree, collectTreeKeys, collectUniqueFolderIds, type FolderTreeNode } from './favoritesTree'
import { useWorkspaceVisible } from './workspaceVisibility'

// 收藏夹树选择器：一棵树、两种用途。
// - favorite（默认）：多选，「收藏到收藏夹」，已收藏的页预勾选，确认后增删引用。
// - move：多选，「移动到收藏夹」，排除当前所在页，确认后把引用迁移到所选各页（源页不再保留）。

type FavoritesSaveResult = {
  selectedFolderIds: string[]
  alreadySavedFolderIds: string[]
}

export type { FavoritesSaveResult }

type Props = {
  open: boolean
  doc: HyperCortexFavoritesDocV1
  kind: FavoriteItemRef['kind']
  targetId: string
  /** 选择模式：多选收藏（默认）或多选移动。 */
  mode?: 'favorite' | 'move'
  /** 移动模式下引用当前所在的收藏夹：该页不可作为目标（移到自己无意义）。 */
  sourceFolderId?: string
  onClose: () => void
  onSave: (result: FavoritesSaveResult) => void
}

export function FavoritesTreePickerDialog(props: Props): React.ReactNode {
  const { open, doc, kind, targetId, mode = 'favorite', sourceFolderId, onClose, onSave } = props
  const workspaceVisible = useWorkspaceVisible()
  const isMove = mode === 'move'

  const nodes = React.useMemo(() => buildFolderTree(doc), [doc])
  const allTreeKeys = React.useMemo(() => collectTreeKeys(nodes), [nodes])
  const allFolderIds = React.useMemo(() => collectUniqueFolderIds(nodes), [nodes])
  const savedFolderIds = React.useMemo(() => {
    const set = new Set<string>()
    for (const id of allFolderIds) {
      const refs = getRefsByFolderId(doc, id)
      if (refs.some(ref => ref.kind === kind && ref.targetId === targetId)) set.add(id)
    }
    return set
  }, [allFolderIds, doc, kind, targetId])

  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    if (!open) return
    setExpandedKeys(new Set(allTreeKeys))
    setSelectedIds(isMove ? new Set() : new Set(savedFolderIds))
  }, [allTreeKeys, isMove, open, savedFolderIds])

  const toggleExpand = React.useCallback((key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleSelect = React.useCallback(
    (id: string) => {
      if (isMove && id === sourceFolderId) return
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [isMove, sourceFolderId],
  )

  const confirmSave = React.useCallback(() => {
    onSave({ selectedFolderIds: [...selectedIds], alreadySavedFolderIds: isMove ? [] : [...savedFolderIds] })
  }, [isMove, onSave, savedFolderIds, selectedIds])

  const renderNode = (node: FolderTreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const expanded = expandedKeys.has(node.key)
    const isSource = isMove && node.id === sourceFolderId
    return (
      <React.Fragment key={node.key}>
        <Box sx={{ pl: depth * 1.6, pr: 0.75, display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <IconButton size="small" disabled={!hasChildren} onClick={() => hasChildren && toggleExpand(node.key)} aria-label={expanded ? '收起' : '展开'} sx={{ width: 24, height: 24, mx: -0.25 }}>
            <ChevronRightRoundedIcon fontSize="small" sx={{ transition: 'transform .15s ease', transform: expanded ? 'rotate(90deg)' : 'none' }} />
          </IconButton>
          <Box
            role={hasChildren ? 'button' : undefined}
            tabIndex={hasChildren ? 0 : -1}
            onClick={hasChildren ? () => toggleExpand(node.key) : undefined}
            onKeyDown={
              hasChildren
                ? e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleExpand(node.key)
                    }
                  }
                : undefined
            }
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              py: 0.5,
              px: 0.5,
              borderRadius: 2,
              cursor: hasChildren ? 'pointer' : 'default',
              '&:hover': { bgcolor: 'var(--hc-surface-soft)' },
            }}
          >
            <FolderRoundedIcon fontSize="small" sx={{ flexShrink: 0, color: 'var(--hc-primary)' }} />
            <Typography noWrap sx={{ flex: 1, fontSize: 13, fontWeight: 600, color: isSource ? 'rgba(0,0,0,.4)' : undefined }}>
              {node.title}{isSource ? '（当前所在）' : ''}
            </Typography>
            <Checkbox
              size="small"
              checked={selectedIds.has(node.id)}
              disabled={isSource}
              onClick={e => e.stopPropagation()}
              onChange={() => toggleSelect(node.id)}
              sx={{ p: 0.5, m: 0 }}
            />
          </Box>
        </Box>
        {hasChildren && expanded ? node.children.map(child => renderNode(child, depth + 1)) : null}
      </React.Fragment>
    )
  }

  return (
    <Dialog open={workspaceVisible && open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isMove ? '移动到收藏夹' : '收藏到收藏夹'}</DialogTitle>
      <DialogContent>
        {nodes.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.45)' }}>暂无收藏夹可用</Typography>
        ) : (
          <Box role="tree" sx={{ border: '1px solid rgba(0,0,0,.06)', borderRadius: 3, p: 0.75, maxHeight: 'min(440px, 55vh)', overflowY: 'auto' }}>
            {nodes.map(node => renderNode(node, 0))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={selectedIds.size === 0} onClick={confirmSave}>
          {isMove ? '移动' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
