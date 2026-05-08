import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DriveFolderUploadRoundedIcon from '@mui/icons-material/DriveFolderUploadRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import { Box, Button, Chip, IconButton, Paper, Stack, Typography, alpha } from '@mui/material'
import type { ContextMenuState, FolderItem, FoldersDoc, Phase } from '../types'
import { groupName } from '../utils'
import { FOLDER_GRID_ITEM_HEIGHT, FOLDER_GRID_ITEM_WIDTH } from './constants'
import { getFolderGridCanvasHeight, getFolderGridPixelRect, type FolderGridLayoutPatch } from './layout'
import { useFolderGridEditor } from './useFolderGridEditor'

type Props = {
  doc: FoldersDoc
  items: FolderItem[]
  allItems: FolderItem[]
  groupCount: number
  phase: Phase
  search: string
  onAdd(): void
  onOpen(item: FolderItem): void
  onContextMenu(menu: ContextMenuState): void
  onLayoutCommit(patches: FolderGridLayoutPatch[]): void
}

export type { FolderGridLayoutPatch }

export function FolderGridCanvas(props: Props): React.ReactNode {
  const [gridNode, setGridNodeState] = React.useState<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const editor = useFolderGridEditor({ items: props.allItems, containerWidth, onCommit: props.onLayoutCommit })

  const setGridNode = React.useCallback((node: HTMLDivElement | null) => {
    editor.gridRef.current = node
    setGridNodeState(node)
  }, [editor.gridRef])

  React.useLayoutEffect(() => {
    if (!gridNode) {
      setContainerWidth(0)
      return
    }

    const updateWidth = () => setContainerWidth(Math.max(0, gridNode.clientWidth))
    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(gridNode)
    return () => observer.disconnect()
  }, [gridNode])

  if (!props.items.length) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.5, sm: 2 }, pt: 1 }}>
        <EmptyState phase={props.phase} search={props.search} onAdd={props.onAdd} />
      </Box>
    )
  }

  const canvasHeight = getFolderGridCanvasHeight(editor.layouts.values())

  return (
    <Box
      component="section"
      aria-label="收藏文件夹图标布局"
      sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: { xs: 1, sm: 1.5 }, pb: { xs: 1.5, sm: 2 }, pt: 1 }}
    >
      <Box
        ref={setGridNode}
        sx={{
          position: 'relative',
          minHeight: canvasHeight,
        }}
      >
        <Box sx={{ position: 'absolute', top: 10, right: 12, px: 1, py: 0.5, borderRadius: 999, bgcolor: theme => alpha(theme.palette.background.paper, 0.76), color: 'text.secondary', fontSize: 11, fontWeight: 800, pointerEvents: 'none' }}>
          图标布局：拖动到格子，自动让位
        </Box>
        {props.items.map(item => {
          const layout = editor.layouts.get(item.id)
          if (!layout) return null
          const rect = getFolderGridPixelRect(layout)
          return (
            <FolderGridIcon
              key={item.id}
              doc={props.doc}
              dragging={editor.draggingId === item.id}
              groupCount={props.groupCount}
              item={item}
              rect={rect}
              onBeginDrag={event => editor.beginDrag(item, event)}
              onOpen={() => {
                if (!editor.consumeSuppressedClick(item.id)) props.onOpen(item)
              }}
              onContextMenu={(x, y) => props.onContextMenu({ item, x, y })}
            />
          )
        })}
      </Box>
    </Box>
  )
}

function FolderGridIcon(props: {
  doc: FoldersDoc
  dragging: boolean
  groupCount: number
  item: FolderItem
  rect: { left: number; top: number; width: number; height: number }
  onBeginDrag(event: React.PointerEvent): void
  onOpen(): void
  onContextMenu(x: number, y: number): void
}) {
  return (
    <Box
      onPointerDown={props.onBeginDrag}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); props.onContextMenu(event.clientX, event.clientY) }}
      sx={{
        position: 'absolute',
        left: props.rect.left,
        top: props.rect.top,
        width: props.rect.width,
        height: props.rect.height,
        zIndex: props.dragging ? 4 : 1,
        cursor: props.dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        transition: props.dragging ? 'none' : 'left .16s ease, top .16s ease, transform .16s ease',
        transform: props.dragging ? 'scale(1.035)' : 'scale(1)',
      }}
    >
      <Button
        color="inherit"
        onClick={props.onOpen}
        aria-label={`打开文件夹：${props.item.name}`}
        title={props.item.path}
        sx={{
          width: FOLDER_GRID_ITEM_WIDTH,
          height: FOLDER_GRID_ITEM_HEIGHT,
          p: 1,
          pt: 1.25,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: 0.75,
          textAlign: 'center',
          borderRadius: 3.5,
          border: theme => `1px solid ${alpha(theme.palette.primary.main, props.dragging ? 0.34 : 0.12)}`,
          bgcolor: theme => alpha(theme.palette.background.paper, props.dragging ? 0.94 : 0.84),
          boxShadow: props.dragging ? '0 22px 44px rgba(37, 99, 235, 0.22)' : '0 12px 28px rgba(15, 23, 42, 0.08)',
          backdropFilter: 'blur(10px)',
          '&:hover': { bgcolor: 'background.paper', boxShadow: '0 18px 38px rgba(37, 99, 235, 0.16)' },
        }}
      >
        <Box sx={{ width: 58, height: 58, borderRadius: 3.5, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: theme => alpha(theme.palette.primary.main, 0.11), boxShadow: theme => `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.08)}`, flexShrink: 0 }}>
          <FolderRoundedIcon sx={{ fontSize: 34 }} />
        </Box>
        <Box sx={{ minWidth: 0, width: '100%' }}>
          <Typography fontWeight={900} noWrap sx={{ fontSize: 12.5 }}>{props.item.name}</Typography>
          {props.groupCount > 1 ? <Chip size="small" label={groupName(props.doc, props.item.groupId)} sx={{ mt: 0.5, maxWidth: '100%', height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10.5 } }} /> : null}
        </Box>
      </Button>
      <IconButton
        data-folder-grid-no-drag="1"
        aria-label={`更多操作：${props.item.name}`}
        onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); props.onContextMenu(rect.left, rect.bottom + 4) }}
        sx={{ position: 'absolute', top: 4, right: 4, bgcolor: theme => alpha(theme.palette.background.paper, 0.86), backdropFilter: 'blur(8px)' }}
      >
        <MoreVertRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

function EmptyState(props: { phase: Phase; search: string; onAdd(): void }) {
  return (
    <Paper sx={{ minHeight: '100%', p: { xs: 3, sm: 5 }, borderRadius: 4, display: 'grid', placeItems: 'center', textAlign: 'center', bgcolor: 'background.paper' }}>
      <Stack spacing={1.5} alignItems="center" sx={{ maxWidth: 420 }}>
        <Box sx={{ width: 72, height: 72, borderRadius: 4, display: 'grid', placeItems: 'center', color: 'primary.main', bgcolor: theme => alpha(theme.palette.primary.main, 0.1) }}>
          <DriveFolderUploadRoundedIcon fontSize="large" />
        </Box>
        <Typography variant="h2">{props.search ? '未找到匹配的文件夹' : '暂无收藏文件夹'}</Typography>
        <Typography color="text.secondary">{props.search ? '换个关键词试试，或者把这个目录添加到收藏。' : '添加常用目录后，可以从这里一键打开、分组管理和快速搜索。'}</Typography>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={props.onAdd} disabled={props.phase !== 'ready'}>添加文件夹</Button>
      </Stack>
    </Paper>
  )
}
