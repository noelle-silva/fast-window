import * as React from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded'
import { Box, Button, ButtonBase, IconButton, Stack, Typography } from '@mui/material'
import { DesktopIconVisual } from './folder-grid/DesktopIconVisual'
import { DESKTOP_ICON_TITLE_SHADOW } from './folder-grid/desktopIconTokens'
import type { DesktopContainer, FolderItem, FoldersDoc } from './types'

type Props = {
  assetUrl?(assetId: string): string
  container: DesktopContainer | null
  doc: FoldersDoc
  onClose(): void
  onEdit(container: DesktopContainer): void
  onOpenFolder(item: FolderItem): void
  onRemoveItem(item: FolderItem): void
}

const OVERLAY_ICON_SIZE = 86

export function ContainerFolderOverlay(props: Props): React.ReactNode {
  const container = props.container
  const { onClose } = props
  const items = React.useMemo(() => (container ? props.doc.items.filter(item => item.containerId === container.id) : []), [container, props.doc.items])

  React.useEffect(() => {
    if (!container) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [container, onClose])

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
        {items.length ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))',
              gap: { xs: 2.5, sm: 4.5 },
              alignItems: 'start',
            }}
          >
            {items.map(item => (
              <ContainerFolderItem
                key={item.id}
                assetUrl={props.assetUrl}
                item={item}
                onOpen={() => props.onOpenFolder(item)}
                onRemove={() => props.onRemoveItem(item)}
              />
            ))}
          </Box>
        ) : (
          <Stack spacing={1.5} alignItems="center" justifyContent="center" sx={{ minHeight: 220, textAlign: 'center' }}>
            <Typography variant="h2" color="text.primary">这个收纳夹还是空的</Typography>
            <Typography color="text.secondary">可以在编辑收纳夹时选择要收纳的文件夹。</Typography>
          </Stack>
        )}
      </Box>
    </Box>
  )
}

function ContainerFolderItem(props: { assetUrl?(assetId: string): string; item: FolderItem; onOpen(): void; onRemove(): void }) {
  return (
    <Box
      sx={{
        position: 'relative',
        display: 'grid',
        justifyItems: 'center',
        gap: 1,
        minWidth: 0,
        '&:hover .container-folder-remove, &:focus-within .container-folder-remove': { opacity: 1, transform: 'translateY(0) scale(1)' },
      }}
    >
      <ButtonBase
        onClick={props.onOpen}
        aria-label={`打开：${props.item.name}`}
        sx={{
          width: 122,
          display: 'grid',
          justifyItems: 'center',
          gap: 1,
          p: 0.5,
          borderRadius: 5,
          textAlign: 'center',
          '&:focus-visible': { outline: '2px solid rgba(37, 99, 235, 0.75)', outlineOffset: 4 },
        }}
      >
        <DesktopIconVisual
          assetUrl={props.assetUrl}
          icon={props.item.icon}
          seed={`folder:${props.item.id}:${props.item.name}`}
          size={OVERLAY_ICON_SIZE}
          radius={24}
        />
        <Box sx={{ minWidth: 0, width: '100%' }}>
          <Typography noWrap fontWeight={850} title={props.item.name} sx={{ color: 'text.primary', fontSize: 15 }}>
            {props.item.name}
          </Typography>
          <Typography noWrap title={props.item.path} variant="caption" sx={{ display: 'block', color: 'rgba(15, 23, 42, 0.45)', mt: 0.2 }}>
            {props.item.path}
          </Typography>
        </Box>
      </ButtonBase>
      <IconButton
        className="container-folder-remove"
        aria-label={`移出收纳夹：${props.item.name}`}
        onClick={props.onRemove}
        size="small"
        sx={{
          position: 'absolute',
          top: -7,
          right: 16,
          opacity: { xs: 1, sm: 0 },
          transform: { xs: 'translateY(0) scale(1)', sm: 'translateY(-4px) scale(0.92)' },
          transition: 'opacity .16s ease, transform .16s ease, background-color .16s ease',
          bgcolor: 'rgba(255, 255, 255, 0.92)',
          boxShadow: '0 10px 22px rgba(15, 23, 42, 0.16)',
          '&:hover': { bgcolor: '#FFFFFF', color: 'error.main' },
        }}
      >
        <RemoveCircleOutlineRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}
