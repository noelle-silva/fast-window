import * as React from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'
import { ContainerGridCanvas, type ContainerGridApi, type ContainerGridDragEvent, type ContainerGridPlacement } from './folder-grid/ContainerGridCanvas'
import type { FolderGridDragEndResult } from './folder-grid/useMuuriFolderGrid'
import { DESKTOP_ICON_TITLE_SHADOW } from './folder-grid/desktopIconTokens'
import type { DesktopContainer, FolderGridLayout, FolderItem, FoldersDoc } from './types'

type Props = {
  assetUrl?(assetId: string): string
  container: DesktopContainer | null
  dropTargetActive?: boolean
  doc: FoldersDoc
  onClose(): void
  onEdit(container: DesktopContainer): void
  onItemDragCancel?(event: ContainerFolderDragEvent): void
  onItemDragEnd?(event: ContainerFolderDragEvent, patches: ContainerGridPlacement[]): FolderGridDragEndResult | void
  onItemDragMove?(event: ContainerFolderDragEvent): void
  onItemDragStart?(event: ContainerFolderDragEvent): void
  onLayoutCommit(patches: ContainerGridPlacement[]): void
  onOpenFolder(item: FolderItem): void
  onRemoveItem(item: FolderItem): void
  onGridReady?(api: ContainerGridApi | null): void
  softClosed?: boolean
}

export type ContainerFolderDragEvent = ContainerGridDragEvent & { boundary: DOMRect | null }

export function ContainerFolderOverlay(props: Props): React.ReactNode {
  const container = props.container
  const { onClose } = props
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const items = React.useMemo(() => (container ? props.doc.items.filter(item => item.containerId === container.id) : []), [container, props.doc.items])

  React.useEffect(() => {
    if (!container) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !props.softClosed) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [container, onClose, props.softClosed])

  if (!container) return null

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-labelledby="container-folder-overlay-title"
      onClick={props.onClose}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: theme => theme.zIndex.modal,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        px: { xs: 1.5, sm: 4, lg: 7 },
        pt: { xs: 4.5, sm: 5.5 },
        pb: { xs: 2.5, sm: 5 },
        background: 'rgba(2, 6, 23, 0.56)',
        backdropFilter: 'blur(10px) saturate(0.82)',
        WebkitBackdropFilter: 'blur(10px) saturate(0.82)',
        opacity: props.softClosed ? 0 : 1,
        pointerEvents: props.softClosed ? 'none' : 'auto',
        transition: 'opacity .16s ease',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="center" sx={{ position: 'relative', minHeight: 64 }}>
        <Typography
          id="container-folder-overlay-title"
          variant="h1"
          sx={{
            color: '#FFFFFF',
            fontSize: { xs: 28, sm: 40 },
            fontWeight: 950,
            letterSpacing: '-0.035em',
            textAlign: 'center',
            textShadow: DESKTOP_ICON_TITLE_SHADOW,
          }}
        >
          {container.name}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ position: 'absolute', right: 0 }}>
          <Button
            startIcon={<EditRoundedIcon />}
            onClick={event => { event.stopPropagation(); props.onEdit(container) }}
            sx={{ color: '#FFFFFF', bgcolor: 'rgba(255,255,255,0.12)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
          >
            编辑
          </Button>
          <IconButton
            aria-label="关闭收纳夹"
            onClick={event => { event.stopPropagation(); props.onClose() }}
            sx={{ color: '#FFFFFF', bgcolor: 'rgba(255,255,255,0.12)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
          >
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Box
        ref={panelRef}
        onClick={event => event.stopPropagation()}
        sx={{
          alignSelf: 'center',
          justifySelf: 'center',
          width: 'min(92vw, 1478px)',
          minHeight: { xs: 350, sm: 334 },
          maxHeight: 'calc(100vh - 170px)',
          overflow: 'auto',
          px: { xs: 2.5, sm: 7, lg: 10 },
          py: { xs: 3, sm: 6 },
          borderRadius: { xs: 8, sm: '58px' },
          background: 'rgba(246, 249, 250, 0.92)',
          border: '1px solid rgba(255, 255, 255, 0.72)',
          boxShadow: '0 42px 90px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.78)',
          backdropFilter: 'blur(28px) saturate(1.04)',
          WebkitBackdropFilter: 'blur(28px) saturate(1.04)',
        }}
      >
        {items.length || props.dropTargetActive ? (
          <ContainerGridCanvas
            assetUrl={props.assetUrl}
            dropTargetActive={props.dropTargetActive}
            items={items}
            onDragCancel={event => props.onItemDragCancel?.(withBoundary(event, panelRef.current))}
            onDragEnd={(event, patches) => props.onItemDragEnd?.(withBoundary(event, panelRef.current), patches)}
            onDragMove={event => props.onItemDragMove?.(withBoundary(event, panelRef.current))}
            onDragStart={event => props.onItemDragStart?.(withBoundary(event, panelRef.current))}
            onLayoutCommit={props.onLayoutCommit}
            onOpenFolder={props.onOpenFolder}
            onRemoveItem={props.onRemoveItem}
            onReady={props.onGridReady}
          />
        ) : (
          <Stack spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight: 220, textAlign: 'center' }}>
            <Typography variant="h2" color="text.primary">这个收纳夹还是空的</Typography>
            <Typography color="text.secondary">把桌面文件夹拖到这个收纳夹上停留，即可展开并放入。</Typography>
          </Stack>
        )}
      </Box>
    </Box>
  )
}

function withBoundary(event: ContainerGridDragEvent, panel: HTMLDivElement | null): ContainerFolderDragEvent {
  return { ...event, boundary: panel?.getBoundingClientRect() || null }
}
