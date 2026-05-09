import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DriveFolderUploadRoundedIcon from '@mui/icons-material/DriveFolderUploadRounded'
import { Box, Button, Paper, Stack, Typography, alpha } from '@mui/material'
import type { ContextMenuState, DesktopGridEntry, FoldersDoc, Phase } from '../types'
import { DesktopGridIcon } from './DesktopGridIcon'
import { desktopEntryKey, parseDesktopEntryKey, type DesktopGridLayoutPatch } from './desktopEntries'
import { getFolderGridCanvasHeight, getFolderGridPixelRect, type FolderGridLayoutPatch, type FolderGridLayoutSource } from './layout'
import { useDesktopGridEditor } from './useDesktopGridEditor'

type Props = {
  doc: FoldersDoc
  entries: DesktopGridEntry[]
  allEntries: DesktopGridEntry[]
  groupCount: number
  phase: Phase
  search: string
  assetUrl?(assetId: string): string
  onAdd(): void
  onOpen(entry: DesktopGridEntry): void
  onContextMenu(menu: ContextMenuState): void
  onLayoutCommit(patches: DesktopGridLayoutPatch[]): void
}

export type { DesktopGridLayoutPatch }

export function FolderGridCanvas(props: Props): React.ReactNode {
  const [gridNode, setGridNodeState] = React.useState<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const layoutItems = React.useMemo<FolderGridLayoutSource[]>(() => props.allEntries.map(entry => ({ id: desktopEntryKey(entry.kind, entry.id), layout: entry.layout })), [props.allEntries])
  const visibleEntryByKey = React.useMemo(() => new Map(props.entries.map(entry => [desktopEntryKey(entry.kind, entry.id), entry])), [props.entries])
  const editor = useDesktopGridEditor({
    items: layoutItems,
    containerWidth,
    onCommit: patches => props.onLayoutCommit(patches.map(toDesktopGridLayoutPatch).filter((patch): patch is DesktopGridLayoutPatch => Boolean(patch))),
  })

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

  if (!props.entries.length) {
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
        {props.entries.map(entry => {
          const key = desktopEntryKey(entry.kind, entry.id)
          const layout = editor.layouts.get(key)
          if (!layout) return null
          const rect = getFolderGridPixelRect(layout)
          return (
            <DesktopGridIcon
              key={key}
              assetUrl={props.assetUrl}
              doc={props.doc}
              dragging={editor.draggingId === key}
              entry={entry}
              groupCount={props.groupCount}
              rect={rect}
              onBeginDrag={event => editor.beginDrag(key, event)}
              onOpen={() => {
                if (!editor.consumeSuppressedClick(key)) props.onOpen(entry)
              }}
              onContextMenu={(x, y) => props.onContextMenu({ entry: visibleEntryByKey.get(key) || entry, x, y })}
            />
          )
        })}
      </Box>
    </Box>
  )
}

function toDesktopGridLayoutPatch(patch: FolderGridLayoutPatch): DesktopGridLayoutPatch | null {
  const parsed = parseDesktopEntryKey(patch.id)
  return parsed ? { ...parsed, layout: patch.layout } : null
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
