import * as React from 'react'
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { getFolderById, getFolderRefs, getRefsByFolderId } from '../favorites'

type FolderTreeNode = {
  key: string
  id: string
  title: string
  children: FolderTreeNode[]
}

function folderDisplayTitle(folderId: string, title?: string): string {
  if (String(folderId || '').trim() === 'root') return '根目录'
  return String(title || '').trim() || '未命名收藏夹'
}

function buildFolderTree(doc: HyperCortexFavoritesDocV1): FolderTreeNode[] {
  const walk = (folderId: string, path: string[]): FolderTreeNode | null => {
    const id = String(folderId || '').trim()
    if (!id || path.includes(id)) return null
    const folder = getFolderById(doc, id)
    if (!folder) return null
    const currentPath = [...path, id]
    const children: FolderTreeNode[] = []
    for (const ref of getFolderRefs(doc, id)) {
      const child = walk(ref.targetId, currentPath)
      if (child) children.push(child)
    }
    return {
      key: currentPath.join('/'),
      id,
      title: folderDisplayTitle(id, folder.title),
      children,
    }
  }
  const root = walk(doc.rootFolderId || 'root', [])
  return root ? [root] : []
}

function collectTreeKeys(nodes: FolderTreeNode[]): string[] {
  const out: string[] = []
  for (const node of nodes) {
    out.push(node.key)
    out.push(...collectTreeKeys(node.children))
  }
  return out
}

function collectUniqueFolderIds(nodes: FolderTreeNode[]): string[] {
  const set = new Set<string>()
  const walk = (list: FolderTreeNode[]) => {
    for (const n of list) {
      set.add(n.id)
      walk(n.children)
    }
  }
  walk(nodes)
  return [...set]
}

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
  onClose: () => void
  onSave: (result: FavoritesSaveResult) => void
}

export function FavoritesTreePickerDialog(props: Props): React.ReactNode {
  const { open, doc, kind, targetId, onClose, onSave } = props

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
    setSelectedIds(new Set(savedFolderIds))
  }, [allTreeKeys, open, savedFolderIds])

  const toggleExpand = React.useCallback((key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleSelect = React.useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const confirmSave = React.useCallback(() => {
    onSave({ selectedFolderIds: [...selectedIds], alreadySavedFolderIds: [...savedFolderIds] })
  }, [onSave, savedFolderIds, selectedIds])

  const renderNode = (node: FolderTreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const expanded = expandedKeys.has(node.key)
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
            <Typography noWrap sx={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{node.title}</Typography>
            <Checkbox
              size="small"
              checked={selectedIds.has(node.id)}
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>收藏到收藏夹</DialogTitle>
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
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
