import * as React from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import { Box, IconButton, Stack, TextField, Typography } from '@mui/material'
import { ContainerGridCanvas, type ContainerGridApi, type ContainerGridDragEvent, type ContainerGridPlacement } from './folder-grid/ContainerGridCanvas'
import { ScrollArea } from './shared/scroll-area'
import type { FolderGridDragEndResult } from './folder-grid/useMuuriFolderGrid'
import { DESKTOP_ICON_TITLE_SHADOW } from './folder-grid/desktopIconTokens'
import type { CategoryWorkspaceView, CollectionContainer, CollectionItem } from './types'

type Props = {
  assetUrl?(assetId: string): string
  container: CollectionContainer | null
  closeDisabled?: boolean
  dropTargetActive?: boolean
  doc: CategoryWorkspaceView
  hiddenItemId?: string
  onClose(): void
  onDismissContextMenu(): void
  onItemDragCancel?(event: ContainerItemDragEvent): void
  onItemDragEnd?(event: ContainerItemDragEvent, patches: ContainerGridPlacement[]): FolderGridDragEndResult | void
  onItemDragMove?(event: ContainerItemDragEvent): void
  onItemDragStart?(event: ContainerItemDragEvent): void
  onLayoutCommit(patches: ContainerGridPlacement[]): void
  onBlankContextMenu(container: CollectionContainer, x: number, y: number): void
  onContextMenu(item: CollectionItem, x: number, y: number): void
  onOpenItem(item: CollectionItem): void
  onRemoveItem(item: CollectionItem): void
  onRename(container: CollectionContainer, name: string): Promise<void> | void
  onGridReady?(containerId: string, instanceId: string, api: ContainerGridApi | null): void
  softClosed?: boolean
}

export type ContainerItemDragEvent = ContainerGridDragEvent & { boundary: DOMRect | null }

export function ContainerOverlay(props: Props): React.ReactNode {
  const container = props.container
  const { closeDisabled, onClose, onDismissContextMenu } = props
  const instanceId = React.useId()
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [editingName, setEditingName] = React.useState(false)
  const [draftName, setDraftName] = React.useState('')
  const [savingName, setSavingName] = React.useState(false)
  const items = React.useMemo(() => (container ? props.doc.items.filter(item => item.containerId === container.id && item.id !== props.hiddenItemId) : []), [container, props.doc.items, props.hiddenItemId])
  const requestClose = React.useCallback(() => {
    onDismissContextMenu()
    if (!closeDisabled) onClose()
  }, [closeDisabled, onClose, onDismissContextMenu])

  const dismissPanelClick: React.MouseEventHandler = event => {
    event.stopPropagation()
    onDismissContextMenu()
  }

  const openBlankContextMenu: React.MouseEventHandler = event => {
    event.preventDefault()
    event.stopPropagation()
    if (!container) throw new Error('container blank context menu missing container')
    if (isContainerGridItemTarget(event.target)) return
    props.onBlankContextMenu(container, event.clientX, event.clientY)
  }

  React.useEffect(() => {
    setEditingName(false)
    setDraftName(container?.name || '')
  }, [container?.id, container?.name])

  React.useEffect(() => {
    if (!container) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !props.softClosed) requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [container, props.softClosed, requestClose])

  if (!container) return null

  const cancelNameEdit = () => {
    setDraftName(container.name)
    setEditingName(false)
  }

  const commitNameEdit = async () => {
    const name = draftName.trim()
    if (!name || name === container.name) {
      cancelNameEdit()
      return
    }
    setSavingName(true)
    try {
      await props.onRename(container, name)
      setEditingName(false)
    } catch {
      setDraftName(name)
    } finally {
      setSavingName(false)
    }
  }

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-labelledby="container-overlay-title"
      onClick={requestClose}
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
        {editingName ? (
          <TextField
            id="container-overlay-title"
            value={draftName}
            autoFocus
            disabled={savingName}
            onBlur={() => { void commitNameEdit() }}
            onChange={event => setDraftName(event.target.value)}
            onClick={dismissPanelClick}
            onFocus={event => event.currentTarget.select()}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelNameEdit()
              }
              if (event.key === 'Enter' && !(event.nativeEvent as KeyboardEvent).isComposing) {
                event.preventDefault()
                void commitNameEdit()
              }
            }}
            inputProps={{ 'aria-label': '收纳夹名称' }}
            variant="standard"
            sx={{
              width: 'min(78vw, 680px)',
              '& .MuiInputBase-root': { color: '#FFFFFF', fontSize: { xs: 28, sm: 40 }, fontWeight: 950, letterSpacing: '-0.035em' },
              '& .MuiInput-input': { textAlign: 'center', textShadow: DESKTOP_ICON_TITLE_SHADOW, pb: 0.4 },
              '& .MuiInput-underline:before': { borderBottomColor: 'rgba(255,255,255,0.46)' },
              '& .MuiInput-underline:hover:before': { borderBottomColor: 'rgba(255,255,255,0.76)' },
              '& .MuiInput-underline:after': { borderBottomColor: '#FFFFFF' },
            }}
          />
        ) : (
          <Typography
            id="container-overlay-title"
            component="button"
            type="button"
            aria-label="点击修改收纳夹名称"
            title="点击修改名称"
            onClick={event => { dismissPanelClick(event); setEditingName(true) }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setEditingName(true)
              }
            }}
            sx={{
              p: 0,
              border: 0,
              background: 'transparent',
              color: '#FFFFFF',
              cursor: 'text',
              font: 'inherit',
              fontSize: { xs: 28, sm: 40 },
              fontWeight: 950,
              letterSpacing: '-0.035em',
              lineHeight: 1.18,
              textAlign: 'center',
              textShadow: DESKTOP_ICON_TITLE_SHADOW,
              '&:focus-visible': {
                outline: '2px solid rgba(255,255,255,0.92)',
                outlineOffset: 8,
                borderRadius: 2,
              },
            }}
          >
            {container.name}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ position: 'absolute', right: 0 }}>
          <IconButton
            aria-label="关闭收纳夹"
            disabled={props.closeDisabled}
            onClick={event => { event.stopPropagation(); requestClose() }}
            sx={{ color: '#FFFFFF', bgcolor: 'rgba(255,255,255,0.12)', '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' } }}
          >
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
      </Stack>

      <ScrollArea
        ref={panelRef}
        onClick={dismissPanelClick}
        onContextMenu={openBlankContextMenu}
        sx={{
          alignSelf: 'center',
          justifySelf: 'center',
          width: 'min(92vw, 1478px)',
          minHeight: { xs: 350, sm: 334 },
          maxHeight: 'calc(100vh - 170px)',
          borderRadius: { xs: 8, sm: '58px' },
          background: 'rgba(246, 249, 250, 0.92)',
          border: '1px solid rgba(255, 255, 255, 0.72)',
          boxShadow: '0 42px 90px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.78)',
          backdropFilter: 'blur(28px) saturate(1.04)',
          WebkitBackdropFilter: 'blur(28px) saturate(1.04)',
        }}
        viewportSx={{ px: { xs: 2.5, sm: 7, lg: 10 }, py: { xs: 3, sm: 6 } }}
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
            onContextMenu={props.onContextMenu}
            onOpenItem={props.onOpenItem}
            onRemoveItem={props.onRemoveItem}
            onReady={api => props.onGridReady?.(container.id, instanceId, api)}
          />
        ) : (
          <Stack spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight: 220, textAlign: 'center' }}>
            <Typography variant="h2" color="text.primary">这个收纳夹还是空的</Typography>
            <Typography color="text.secondary">把桌面收藏项拖到这个收纳夹上停留，即可展开并放入。</Typography>
          </Stack>
        )}
      </ScrollArea>
    </Box>
  )
}

function isContainerGridItemTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-container-grid-item]'))
}

function withBoundary(event: ContainerGridDragEvent, panel: HTMLDivElement | null): ContainerItemDragEvent {
  return { ...event, boundary: panel?.getBoundingClientRect() || null }
}
