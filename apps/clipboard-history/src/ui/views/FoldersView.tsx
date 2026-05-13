import * as React from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import NoteAddRoundedIcon from '@mui/icons-material/NoteAddRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Box, Breadcrumbs, Button, Chip, IconButton, Paper, Stack, Typography } from '@mui/material'
import { itemText } from '../../shared/collectionsDomain'
import type { CollectionImageContent, CollectionItemNode, CollectionNode } from '../../shared/types'
import { EmptyState } from '../components/EmptyState'
import {
  resolveSortMovePosition,
  SortableDragStatus,
  type SortableDragStatusRenderArgs,
  SortableDropTarget,
  type SortableDropTargetRenderArgs,
  SortableItem,
  type SortableItemRenderArgs,
  SortableRoot,
  SortableSection,
} from '../components/SortableDnd'
import type { ClipboardHistoryController } from '../hooks/useClipboardHistoryController'

type FoldersViewProps = {
  controller: ClipboardHistoryController
}

type FolderListProps = FoldersViewProps & {
  folderChildren: CollectionNode[]
  childIds: string[]
}

type DropVisualState = Pick<SortableDropTargetRenderArgs, 'dragMode' | 'isDropCandidate' | 'isDropTarget'>

const dropTargetSx = (drop: DropVisualState) => ({
  bgcolor: drop.isDropTarget ? 'primary.main' : drop.isDropCandidate ? 'action.hover' : undefined,
  color: drop.isDropTarget ? 'primary.contrastText' : undefined,
  outline: drop.isDropTarget ? '2px solid' : undefined,
  outlineColor: drop.isDropTarget ? 'primary.dark' : undefined,
  outlineOffset: drop.isDropTarget ? -2 : undefined,
  boxShadow: drop.isDropTarget ? 'inset 0 0 0 1px rgba(255,255,255,0.35)' : undefined,
  transition: drop.dragMode === 'drop' ? 'background-color 120ms ease, color 120ms ease, outline-color 120ms ease' : undefined,
})

const dragHintSx = (status: SortableDragStatusRenderArgs) => ({
  px: 1.25,
  py: 0.5,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.35,
  whiteSpace: 'nowrap',
  color: status.isDropMode ? 'primary.contrastText' : 'text.secondary',
  bgcolor: status.isDropMode ? 'primary.main' : status.isDragging ? 'action.selected' : 'action.hover',
  boxShadow: status.isDropMode ? '0 10px 24px rgba(14, 116, 144, 0.22)' : 'none',
  transition: 'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
})

function dragHintText(status: SortableDragStatusRenderArgs): string {
  if (!status.isDragging) return '提示：按住 Ctrl 拖拽，可直接移动到收藏夹或路径栏'
  if (status.isDropMode) return status.overId ? '松手移动到高亮收藏夹' : '拖到收藏夹或路径栏节点即可移动'
  return '拖拽排序中；按住 Ctrl 可切换为移动到收藏夹'
}

export function FoldersView(props: FoldersViewProps) {
  const { controller } = props
  const { state, bootStatus, bootError } = controller
  const folderChildren = state.collections && bootStatus === 'ready' ? controller.listChildren(state.currentFolderId) : []
  const sourceChildIds = React.useMemo(() => folderChildren.map(node => node.id), [folderChildren])
  const [optimisticChildIds, setOptimisticChildIds] = React.useState<string[] | null>(null)
  const childIds = optimisticChildIds || sourceChildIds

  React.useEffect(() => {
    setOptimisticChildIds(null)
  }, [state.currentFolderId, sourceChildIds.join('\n')])

  const canDropIntoFolder = React.useCallback((activeId: string, targetId: string) => {
    const active = controller.getNode(activeId)
    const target = controller.getNode(targetId)
    if (targetId === state.currentFolderId && childIds.includes(activeId)) return false
    return !!active && target?.type === 'folder' && controller.canMoveInto(targetId, activeId)
  }, [childIds, controller, state.currentFolderId])

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

  const handleDropIntoFolder = React.useCallback((activeId: string, targetFolderId: string) => {
    if (!canDropIntoFolder(activeId, targetFolderId)) return
    setOptimisticChildIds(childIds.filter(id => id !== activeId))
    void controller.moveNode(activeId, targetFolderId)
      .then(() => {
        void controller.host.toast(`已移动到：${controller.folderLabelById(targetFolderId)}`)
      })
      .catch(error => {
        setOptimisticChildIds(null)
        void controller.host.toast(String((error as any)?.message || error || '移动失败'))
      })
  }, [canDropIntoFolder, childIds, controller])

  const folderDrop = React.useMemo(() => ({
    canDrop: canDropIntoFolder,
    onDrop: handleDropIntoFolder,
  }), [canDropIntoFolder, handleDropIntoFolder])

  if (bootStatus !== 'ready') {
    return <EmptyState message={bootStatus === 'error' ? bootError || '剪贴板历史启动失败' : '剪贴板历史正在启动...'} />
  }

  if (!state.collections) return null

  return (
    <SortableRoot onMove={handleMove} drop={folderDrop}>
      <Stack spacing={1.25} sx={{ position: 'relative' }}>
        <FoldersSubbar controller={controller} />
        <FolderList controller={controller} folderChildren={folderChildren} childIds={childIds} />
      </Stack>
    </SortableRoot>
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
              <SortableDropTarget key={id} id={`breadcrumb:${id}`} targetId={id} disabled={node?.type !== 'folder'}>
                {(drop) => (
                  <Button
                    ref={drop.setNodeRef}
                    size="small"
                    onClick={(event) => {
                      if (drop.shouldSuppressClick()) {
                        event.preventDefault()
                        return
                      }
                      controller.navigateFolder(id)
                    }}
                    sx={{
                      borderRadius: 999,
                      ...dropTargetSx(drop),
                      '&:hover': { bgcolor: drop.isDropTarget ? 'primary.main' : 'action.hover' },
                    }}
                  >
                    {name}
                  </Button>
                )}
              </SortableDropTarget>
            )
          })}
        </Breadcrumbs>
        <IconButton size="small" title="后退" disabled={!state.navBack.length} onClick={controller.navigateBack}>
          <ArrowBackRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" title="前进" disabled={!state.navForward.length} onClick={controller.navigateForward}>
          <ArrowForwardRoundedIcon fontSize="small" />
        </IconButton>
        <SortableDragStatus>
          {(status) => (
            <Box role="status" aria-live="polite" sx={dragHintSx(status)}>
              {dragHintText(status)}
            </Box>
          )}
        </SortableDragStatus>
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

function FolderList(props: FolderListProps) {
  const { controller, childIds } = props
  const { state } = controller
  const query = state.folderSearchQuery.trim()
  const results = query ? controller.searchItems(query, state.folderSearchScope) : []
  const folderChildren = query ? [] : props.folderChildren
  const sortedChildren = React.useMemo(() => orderNodesByIds(folderChildren, childIds), [childIds, folderChildren])

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

  if (!folderChildren.length) return <EmptyState message="当前收藏夹为空" />

  return (
    <Paper sx={{ borderRadius: 1.5, overflow: 'hidden', boxShadow: '0 10px 28px rgba(15, 23, 42, 0.06)' }}>
      <SortableSection items={childIds}>
        <Stack spacing={0.25}>
          {sortedChildren.map(node => (
            <SortableItem key={node.id} id={node.id}>
              {(sortable) => <FolderCard node={node} controller={controller} sortable={sortable} />}
            </SortableItem>
          ))}
        </Stack>
      </SortableSection>
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
        <Chip size="small" label={item.content.type === 'image' ? '图片' : '文本'} />
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
      <ItemContentPreview content={item.content} controller={controller} />
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
  const dropSx = dropTargetSx(sortable)

  return (
    <Box
      ref={sortable.setNodeRef}
      role="button"
      tabIndex={0}
      style={sortable.style}
      {...sortable.dropActivatorProps}
      onContextMenu={(event) => {
        event.preventDefault()
        controller.setContextMenu(true, node.id, event.clientX, event.clientY)
      }}
      onClick={(event) => {
        if (sortable.shouldSuppressClick()) {
          event.preventDefault()
          return
        }
        if (node.type === 'folder') controller.navigateFolder(node.id)
        else void controller.copyFolderItem(node.id)
      }}
      sx={{
        p: 1.25,
        cursor: 'pointer',
        ...dropSx,
        bgcolor: sortable.isDragging && !sortable.isDropTarget && !sortable.isDropCandidate ? 'action.selected' : dropSx.bgcolor,
        opacity: sortable.isDragging ? 0.82 : 1,
        position: 'relative',
        '&:hover': { bgcolor: sortable.isDropTarget ? 'primary.main' : 'action.hover' },
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
            <Chip size="small" icon={node.content.type === 'image' ? <ImageRoundedIcon fontSize="small" /> : undefined} label={node.content.type === 'image' ? '图片' : '文本'} />
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
        <ItemContentPreview content={node.content} controller={controller} />
      ) : null}
    </Box>
  )
}

function ItemContentPreview(props: { content: CollectionItemNode['content']; controller: ClipboardHistoryController }) {
  const { content, controller } = props
  if (content.type === 'image') return <CollectionImagePreview image={content} controller={controller} />
  return <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 }}>{itemText(content)}</Typography>
}

function CollectionImagePreview(props: { image: CollectionImageContent; controller: ClipboardHistoryController }) {
  const { image, controller } = props
  const directSrc = React.useMemo(() => controller.collectionImageUrl(image), [controller, image])
  return (
    <Stack alignItems="flex-start" spacing={0.75}>
      <Box
        component="img"
        src={directSrc}
        alt={image.sourceName || '收藏图片'}
        decoding="async"
        loading="lazy"
        sx={{ display: 'block', maxWidth: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 1.25, bgcolor: 'action.hover' }}
      />
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Chip size="small" icon={<ImageRoundedIcon fontSize="small" />} label="图片" />
        <Chip size="small" label={`${image.width} x ${image.height}`} />
        {image.sourceName ? <Chip size="small" label={image.sourceName} /> : null}
      </Stack>
    </Stack>
  )
}
