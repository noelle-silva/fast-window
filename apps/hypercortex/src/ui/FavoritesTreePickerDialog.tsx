import * as React from 'react'
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, TextField, Typography } from '@mui/material'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { getFolderById, getFolderRefs, getRefsByFolderId } from '../favorites'
import { getFolderRefIssue } from '../favoritesGraph'
import { EntityIcon } from './entity-icon/EntityIcon'
import { buildFolderTree, collectTreeKeys, collectUniqueFolderIds, filterFolderTree, type FolderTreeNode } from './favoritesTree'
import { useWorkspaceVisible } from './workspaceVisibility'

// 收藏夹树选择器：一棵树、三种用途，共用同一套树、搜索与定位。
// - favorite（默认）：多选，「收藏到收藏夹」，已收藏的页预勾选，确认后增删引用。
// - move：多选，「移动到收藏夹」，排除当前所在页，确认后把引用迁移到所选各页（源页不再保留）。
// - add-folder：多选，「添加已有收藏夹」，把选中的收藏夹作为引用加入当前页，已在当前页的预勾选。
// 文件夹引用会形成循环的条目一律灰掉、不可勾选，并在行尾标注原因；笔记、附件不涉及循环。

type FavoritesSaveResult = {
  selectedFolderIds: string[]
  alreadySavedFolderIds: string[]
}

export type { FavoritesSaveResult }

type BaseProps = {
  open: boolean
  doc: HyperCortexFavoritesDocV1
  onClose: () => void
  onSave: (result: FavoritesSaveResult) => void
}

type FavoriteModeProps = {
  mode?: 'favorite'
  kind: FavoriteItemRef['kind']
  targetId: string
}

type MoveModeProps = {
  mode: 'move'
  kind: FavoriteItemRef['kind']
  targetId: string
  /** 移动模式下引用当前所在的收藏夹：该页不可作为目标（移到自己无意义）。 */
  sourceFolderId: string
}

type AddFolderModeProps = {
  mode: 'add-folder'
  /** 接收引用的当前收藏夹：选中的收藏夹将作为引用加入此页。 */
  containerFolderId: string
}

export type FavoritesTreePickerDialogProps = BaseProps & (FavoriteModeProps | MoveModeProps | AddFolderModeProps)

/** 会形成循环引用的收藏夹条目在行尾的统一标注。 */
const CYCLE_REASON = '会形成循环引用，不能添加'

export function FavoritesTreePickerDialog(props: FavoritesTreePickerDialogProps): React.ReactNode {
  const { open, doc, onClose, onSave } = props
  const workspaceVisible = useWorkspaceVisible()
  const isMove = props.mode === 'move'
  const isAddFolder = props.mode === 'add-folder'
  // 添加已有收藏夹模式下操作对象恒为收藏夹；其余模式由调用方给出条目类型。
  const itemKind: FavoriteItemRef['kind'] = props.mode === 'add-folder' ? 'folder' : props.kind
  const targetId = props.mode === 'add-folder' ? '' : props.targetId
  const sourceFolderId = props.mode === 'move' ? props.sourceFolderId : ''
  const containerFolderId = props.mode === 'add-folder' ? props.containerFolderId : ''

  const nodes = React.useMemo(() => buildFolderTree(doc), [doc])
  const allTreeKeys = React.useMemo(() => collectTreeKeys(nodes), [nodes])
  const allFolderIds = React.useMemo(() => collectUniqueFolderIds(nodes), [nodes])

  // 预勾选集合：收藏模式为已含该条目的收藏夹；添加模式为当前页已引用的收藏夹；移动模式不预勾选。
  const savedFolderIds = React.useMemo(() => {
    const set = new Set<string>()
    if (isAddFolder) {
      for (const ref of getFolderRefs(doc, containerFolderId)) set.add(ref.targetId)
      return set
    }
    for (const id of allFolderIds) {
      const refs = getRefsByFolderId(doc, id)
      if (refs.some(ref => ref.kind === itemKind && ref.targetId === targetId)) set.add(id)
    }
    return set
  }, [allFolderIds, containerFolderId, doc, isAddFolder, itemKind, targetId])

  // 会形成循环引用的收藏夹条目：一律灰掉、不可勾选；笔记、附件不涉及循环，不做判定。
  const disabledReasonById = React.useMemo(() => {
    const out = new Map<string, string>()
    if (itemKind !== 'folder') return out
    for (const id of allFolderIds) {
      if (isMove && id === sourceFolderId) continue
      const issue = isAddFolder ? getFolderRefIssue(doc, containerFolderId, id) : getFolderRefIssue(doc, id, targetId)
      if (issue === 'cycle' || issue === 'self-reference') out.set(id, CYCLE_REASON)
    }
    return out
  }, [allFolderIds, containerFolderId, doc, isAddFolder, isMove, itemKind, sourceFolderId, targetId])

  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setExpandedKeys(new Set(allTreeKeys))
    setSelectedIds(isMove ? new Set() : new Set(savedFolderIds))
    setQuery('')
  }, [allTreeKeys, isMove, open, savedFolderIds])

  // 搜索只改变呈现：过滤后保留命中项与其祖先，并自动展开到命中处；清空后回到原有展开状态。
  const isSearching = query.trim().length > 0
  const visibleNodes = React.useMemo(() => filterFolderTree(nodes, query), [nodes, query])
  const effectiveExpandedKeys = React.useMemo(
    () => (isSearching ? new Set(collectTreeKeys(visibleNodes)) : expandedKeys),
    [isSearching, visibleNodes, expandedKeys],
  )

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
      if (disabledReasonById.has(id)) return
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [disabledReasonById, isMove, sourceFolderId],
  )

  const confirmSave = React.useCallback(() => {
    onSave({ selectedFolderIds: [...selectedIds], alreadySavedFolderIds: isMove ? [] : [...savedFolderIds] })
  }, [isMove, onSave, savedFolderIds, selectedIds])

  const renderNode = (node: FolderTreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    // 搜索态下树自动展开到命中处，锁定手动折叠，避免污染原有展开状态。
    const canExpand = hasChildren && !isSearching
    const expanded = effectiveExpandedKeys.has(node.key)
    const isSource = isMove && node.id === sourceFolderId
    const disabledReason = disabledReasonById.get(node.id) || ''
    const disabled = isSource || !!disabledReason
    return (
      <React.Fragment key={node.key}>
        <Box sx={{ pl: depth * 1.6, pr: 0.75, display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <IconButton size="small" disabled={!canExpand} onClick={() => canExpand && toggleExpand(node.key)} aria-label={expanded ? '收起' : '展开'} sx={{ width: 24, height: 24, mx: -0.25 }}>
            <ChevronRightRoundedIcon fontSize="small" sx={{ transition: 'transform .15s ease', transform: expanded ? 'rotate(90deg)' : 'none' }} />
          </IconButton>
          <Box
            role={canExpand ? 'button' : undefined}
            tabIndex={canExpand ? 0 : -1}
            onClick={canExpand ? () => toggleExpand(node.key) : undefined}
            onKeyDown={
              canExpand
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
              cursor: canExpand ? 'pointer' : 'default',
              '&:hover': { bgcolor: 'var(--hc-surface-soft)' },
            }}
          >
            <EntityIcon
              icon={getFolderById(doc, node.id)?.icon}
              fallback={<FolderRoundedIcon fontSize="small" sx={{ flexShrink: 0, color: disabled ? 'rgba(0,0,0,.26)' : 'var(--hc-primary)' }} />}
              targetKind="folder"
              targetRef={node.id}
              size={18}
              sx={{ flexShrink: 0 }}
            />
            <Typography noWrap sx={{ flex: 1, fontSize: 13, fontWeight: 600, color: disabled ? 'rgba(0,0,0,.4)' : undefined }}>
              {node.title}{isSource ? '（当前所在）' : ''}
            </Typography>
            {disabledReason ? (
              <Typography noWrap sx={{ flexShrink: 0, fontSize: 11, color: 'var(--hc-text)' }}>{disabledReason}</Typography>
            ) : (
              <Checkbox
                size="small"
                checked={selectedIds.has(node.id)}
                disabled={isSource}
                onClick={e => e.stopPropagation()}
                onChange={() => toggleSelect(node.id)}
                sx={{ p: 0.5, m: 0 }}
              />
            )}
          </Box>
        </Box>
        {hasChildren && expanded ? node.children.map(child => renderNode(child, depth + 1)) : null}
      </React.Fragment>
    )
  }

  return (
    <Dialog open={workspaceVisible && open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isMove ? '移动到收藏夹' : isAddFolder ? '添加已有收藏夹' : '收藏到收藏夹'}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          size="small"
          fullWidth
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索收藏夹…"
          aria-label="搜索收藏夹"
          sx={{ mb: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" sx={{ color: 'rgba(0,0,0,.4)' }} />
              </InputAdornment>
            ),
            endAdornment: query ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setQuery('')} aria-label="清空搜索">
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />
        <Box sx={{ height: 'min(440px, 55vh)', display: 'flex', flexDirection: 'column' }}>
          {nodes.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.45)' }}>暂无收藏夹可用</Typography>
          ) : visibleNodes.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.45)' }}>没有匹配的收藏夹</Typography>
          ) : (
            <Box role="tree" sx={{ border: '1px solid rgba(0,0,0,.06)', borderRadius: 3, p: 0.75, flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {visibleNodes.map(node => renderNode(node, 0))}
            </Box>
          )}
        </Box>
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
