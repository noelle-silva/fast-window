import * as React from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import NoteAddRoundedIcon from '@mui/icons-material/NoteAddRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Box, Breadcrumbs, Button, Chip, IconButton, Paper, Stack, Typography } from '@mui/material'
import type { CollectionItemNode, CollectionNode } from '../../shared/types'
import { EmptyState } from '../components/EmptyState'
import {
  resolveSortMovePosition,
  SortableItem,
  type SortableItemRenderArgs,
  SortableRoot,
  SortableSection,
} from '../components/SortableDnd'
import type { ClipboardHistoryController } from '../hooks/useClipboardHistoryController'

type FoldersViewProps = {
  controller: ClipboardHistoryController
}

export function FoldersView(props: FoldersViewProps) {
  const { controller } = props
  const { state, bootStatus, bootError } = controller

  if (bootStatus !== 'ready') {
    return <EmptyState message={bootStatus === 'error' ? bootError || '剪贴板历史启动失败' : '剪贴板历史正在启动...'} />
  }

  if (!state.collections) return null

  return (
    <Stack spacing={1.25} sx={{ position: 'relative' }}>
      <FoldersSubbar controller={controller} />
      <FolderList controller={controller} />
    </Stack>
  )
}

function FoldersSubbar(props: FoldersViewProps) {
  const { controller } = props
  const { state } = controller
  const pathIds = controller.buildPathIds(state.currentFolderId)

  return (
    <Paper
      sx={{
        p: 1.25,
        boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Breadcrumbs separator={<Chip size="small" label="/" />} sx={{ flex: '1 1 220px' }}>
          {pathIds.map(id => {
            const node = controller.getNode(id)
            const name = node?.type === 'folder' ? node.name : ''
            return (
              <Button key={id} size="small" onClick={() => controller.navigateFolder(id)} sx={{ borderRadius: 999 }}>
                {name}
              </Button>
            )
          })}
        </Breadcrumbs>
        <IconButton size="small" title="后退" disabled={!state.navBack.length} onClick={controller.navigateBack}>
          <ArrowBackRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" title="前进" disabled={!state.navForward.length} onClick={controller.navigateForward}>
          <ArrowForwardRoundedIcon fontSize="small" />
        </IconButton>
        <Button startIcon={<CreateNewFolderRoundedIcon fontSize="small" />} onClick={() => controller.setShowFolderEditor(true)}>
          新建收藏夹
        </Button>
        <Button variant="contained" startIcon={<NoteAddRoundedIcon fontSize="small" />} onClick={() => controller.setShowItemEditor(true)}>
          新建条目
        </Button>
      </Stack>
    </Paper>
  )
}

function FolderList(props: FoldersViewProps) {
  const { controller } = props
  const { state } = controller
  const query = state.folderSearchQuery.trim()
  const results = query ? controller.searchItems(query, state.folderSearchScope) : []
  const children = query ? [] : controller.listChildren(state.currentFolderId)
  const sourceChildIds = React.useMemo(() => children.map(node => node.id), [children])
  const [optimisticChildIds, setOptimisticChildIds] = React.useState<string[] | null>(null)
  const childIds = optimisticChildIds || sourceChildIds
  const sortedChildren = React.useMemo(() => orderNodesByIds(children, childIds), [childIds, children])

  React.useEffect(() => {
    setOptimisticChildIds(null)
  }, [state.currentFolderId, sourceChildIds.join('\n')])

  const handleMove = React.useCallback((activeId: string, overId: string) => {
    const position = resolveSortMovePosition(childIds, activeId, overId)
    if (!position) return
    const movingIndex = childIds.indexOf(activeId)
    let toIndex = childIds.indexOf(overId)
    if (movingIndex < 0 || toIndex < 0) return
    if (position === 'after') toIndex += 1
    if (movingIndex < toIndex) toIndex -= 1
    if (toIndex === movingIndex) return
    const nextIds = moveId(childIds, activeId, toIndex)
    setOptimisticChildIds(nextIds)
    void controller.moveNode(activeId, state.currentFolderId, toIndex)
      .catch(error => {
        setOptimisticChildIds(null)
        void controller.host.toast(String((error as any)?.message || error || '移动失败'))
      })
  }, [childIds, controller, state.currentFolderId])

  if (query) {
    if (!results.length) return <EmptyState message="没有匹配的内容" />
    return (
      <Paper sx={{ borderRadius: 1.5, overflow: 'hidden', boxShadow: '0 10px 28px rgba(15, 23, 42, 0.06)' }}>
        <Stack spacing={0.25}>
          {results.map(({ item, folderId, path }) => (
            <SearchResultCard key={item.id} item={item} folderId={folderId} path={path} controller={controller} />
          ))}
        </Stack>
      </Paper>
    )
  }

  if (!children.length) return <EmptyState message="当前收藏夹为空" />

  return (
    <Paper sx={{ borderRadius: 1.5, overflow: 'hidden', boxShadow: '0 10px 28px rgba(15, 23, 42, 0.06)' }}>
      <SortableRoot onMove={handleMove}>
        <SortableSection items={childIds}>
          <Stack spacing={0.25}>
            {sortedChildren.map(node => (
              <SortableItem key={node.id} id={node.id}>
                {(sortable) => <FolderCard node={node} controller={controller} sortable={sortable} />}
              </SortableItem>
            ))}
          </Stack>
        </SortableSection>
      </SortableRoot>
    </Paper>
  )
}

function moveId(ids: string[], movingId: string, toIndex: number): string[] {
  const next = ids.filter(id => id !== movingId)
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, movingId)
  return next
}

function orderNodesByIds(nodes: CollectionNode[], ids: string[]): CollectionNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const ordered = ids.map(id => byId.get(id)).filter(Boolean) as CollectionNode[]
  const orderedIds = new Set(ordered.map(node => node.id))
  return ordered.concat(nodes.filter(node => !orderedIds.has(node.id)))
}

function SearchResultCard(props: { item: CollectionItemNode; folderId: string; path: string; controller: ClipboardHistoryController }) {
  const { item, folderId, path, controller } = props
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => void controller.copyFolderItem(item.id)}
      sx={{ p: 1.25, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }} onClick={(event) => event.stopPropagation()}>
        <Chip size="small" label="文本" />
        <Chip size="small" label={path} />
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" title="打开所在收藏夹" onClick={() => {
          controller.setFolderSearchQuery('')
          controller.navigateFolder(folderId)
        }}>
          <FolderOpenRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" title="复制" onClick={() => void controller.copyFolderItem(item.id)}>
          <ContentCopyRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 }}>{item.content || ''}</Typography>
    </Box>
  )
}

function FolderCard(props: {
  node: CollectionNode
  controller: ClipboardHistoryController
  sortable: SortableItemRenderArgs
}) {
  const { node, controller, sortable } = props
  const armed = controller.isDeleteArmed(node.id)

  return (
    <Box
      ref={sortable.setNodeRef}
      role="button"
      tabIndex={0}
      style={sortable.style}
      onContextMenu={(event) => {
        event.preventDefault()
        controller.setContextMenu(true, node.id, event.clientX, event.clientY)
      }}
      onClick={() => {
        if (node.type === 'folder') controller.navigateFolder(node.id)
        else void controller.copyFolderItem(node.id)
      }}
      sx={{
        p: 1.25,
        cursor: 'pointer',
        bgcolor: sortable.isDragging ? 'action.selected' : undefined,
        opacity: sortable.isDragging ? 0.82 : 1,
        position: 'relative',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: node.type === 'item' ? 0.75 : 0 }}>
        <IconButton
          ref={sortable.setHandleRef}
          size="small"
          title="拖拽排序"
          aria-label="拖拽排序"
          onClick={(event) => event.stopPropagation()}
          sx={{ cursor: sortable.isDragging ? 'grabbing' : 'grab' }}
          {...sortable.handleProps}
        >
          <DragIndicatorRoundedIcon fontSize="small" />
        </IconButton>
        {node.type === 'folder' ? (
          <>
            <Chip size="small" icon={<FolderRoundedIcon fontSize="small" />} label="" sx={{ '& .MuiChip-label': { display: 'none' } }} />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{node.name}</Typography>
            <Chip size="small" label={`${Array.isArray(node.children) ? node.children.length : 0} 项`} />
          </>
        ) : (
          <>
            <Chip size="small" label="文本" />
            <Chip size="small" label={node.title || ''} />
          </>
        )}
        <Box sx={{ flex: 1 }} />
        {node.type === 'item' ? (
          <IconButton size="small" title="复制" onClick={(event) => {
            event.stopPropagation()
            void controller.copyFolderItem(node.id)
          }}>
            <ContentCopyRoundedIcon fontSize="small" />
          </IconButton>
        ) : null}
        <IconButton size="small" title={armed ? '再点一次确认删除' : '删除'} onClick={(event) => {
          event.stopPropagation()
          void controller.deleteNode(node.id)
        }}>
          {armed ? <WarningAmberRoundedIcon color="warning" fontSize="small" /> : <DeleteOutlineRoundedIcon fontSize="small" />}
        </IconButton>
      </Stack>
      {node.type === 'item' ? (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 }}>{node.content || ''}</Typography>
      ) : null}
    </Box>
  )
}
