import * as React from 'react'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ImageRoundedIcon from '@mui/icons-material/ImageRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import { Box, Button, Chip, IconButton, Paper, Stack, Typography, alpha } from '@mui/material'
import { desktopWallpaperImageSx } from './desktopWallpaperImage'
import { activeDesktopWallpaperPreset } from './desktopWallpaperPresets'
import { DesktopWallpaperViewEditorDialog } from './DesktopWallpaperViewEditorDialog'
import type { DesktopWallpaper, DesktopWallpaperPreset, DesktopWallpaperView } from './types'

type Props = {
  assetUrl?(assetId: string): string
  busy: boolean
  wallpaper?: DesktopWallpaper
  onAddWallpaper(): void
  onClearWallpaper(): void
  onRemovePreset(id: string): void
  onSavePresetView(id: string, view: DesktopWallpaperView): void
  onSelectPreset(id: string): void
}

export function DesktopWallpaperSettings(props: Props): React.ReactNode {
  const [editingPresetId, setEditingPresetId] = React.useState<string | null>(null)
  const targetAspect = useViewportAspect()
  const activePreset = activeDesktopWallpaperPreset(props.wallpaper)
  const editingPreset = props.wallpaper?.presets.find(preset => preset.id === editingPresetId) || null
  const activeUrl = activePreset && props.assetUrl ? props.assetUrl(activePreset.assetId) : null
  const editingUrl = editingPreset && props.assetUrl ? props.assetUrl(editingPreset.assetId) : null

  React.useEffect(() => {
    if (!editingPresetId) return
    if (!props.wallpaper?.presets.some(preset => preset.id === editingPresetId)) setEditingPresetId(null)
  }, [editingPresetId, props.wallpaper?.presets])

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
      <Stack spacing={1.75}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography fontWeight={900}>桌面壁纸预设</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>可添加多张壁纸，每张壁纸单独保存取景位置与缩放。</Typography>
          </Box>
          <Button startIcon={<ImageRoundedIcon />} onClick={props.onAddWallpaper} disabled={props.busy}>添加壁纸</Button>
          <Button startIcon={<RestartAltRoundedIcon />} onClick={props.onClearWallpaper} disabled={props.busy || !props.wallpaper}>清除壁纸</Button>
        </Stack>

        <Box sx={{ position: 'relative', height: 164, borderRadius: 3, overflow: 'hidden', bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
          {activePreset && activeUrl ? (
            <>
              <Box component="img" alt="" draggable={false} src={activeUrl} sx={{ ...desktopWallpaperImageSx(activePreset.view), position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
              <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.42))' }} />
              <Stack direction="row" spacing={1} alignItems="center" sx={{ position: 'absolute', left: 14, right: 14, bottom: 12 }}>
                <Chip size="small" label="当前预设" sx={{ bgcolor: 'rgba(255,255,255,0.88)', fontWeight: 800 }} />
                <Typography noWrap sx={{ color: '#fff', fontWeight: 900, textShadow: '0 2px 8px rgba(0,0,0,0.42)', flex: 1 }}>{activePreset.name}</Typography>
                <Button size="small" variant="contained" startIcon={<TuneRoundedIcon />} onClick={() => setEditingPresetId(activePreset.id)} disabled={props.busy}>调整取景</Button>
              </Stack>
            </>
          ) : (
            <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ height: '100%', textAlign: 'center', px: 2 }}>
              <Typography fontWeight={900}>未选择壁纸</Typography>
              <Typography variant="body2" color="text.secondary">添加图片后，可在这里选择预设并调整取景。</Typography>
            </Stack>
          )}
        </Box>

        {props.wallpaper?.presets.length ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}>
            {props.wallpaper.presets.map(preset => (
              <WallpaperPresetCard
                key={preset.id}
                active={preset.id === props.wallpaper?.activeId}
                assetUrl={props.assetUrl}
                busy={props.busy}
                preset={preset}
                onEditView={() => setEditingPresetId(preset.id)}
                onRemove={() => props.onRemovePreset(preset.id)}
                onSelect={() => props.onSelectPreset(preset.id)}
              />
            ))}
          </Box>
        ) : null}
      </Stack>

      {editingPreset && editingUrl ? (
        <DesktopWallpaperViewEditorDialog
          imageUrl={editingUrl}
          initialView={editingPreset.view}
          open={Boolean(editingPreset)}
          targetAspect={targetAspect}
          onClose={() => setEditingPresetId(null)}
          onSave={view => { props.onSavePresetView(editingPreset.id, view); setEditingPresetId(null) }}
        />
      ) : null}
    </Paper>
  )
}

function WallpaperPresetCard(props: {
  active: boolean
  assetUrl?(assetId: string): string
  busy: boolean
  preset: DesktopWallpaperPreset
  onEditView(): void
  onRemove(): void
  onSelect(): void
}) {
  const src = props.assetUrl?.(props.preset.assetId)
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={props.active ? `当前壁纸预设：${props.preset.name}` : `切换壁纸预设：${props.preset.name}`}
      onClick={() => { if (!props.busy) props.onSelect() }}
      onKeyDown={event => {
        if (props.busy) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onSelect()
        }
      }}
      sx={{
        position: 'relative',
        minHeight: 112,
        overflow: 'hidden',
        borderRadius: 2,
        border: '2px solid',
        borderColor: props.active ? 'primary.main' : 'transparent',
        bgcolor: 'action.hover',
        cursor: props.busy ? 'not-allowed' : 'pointer',
        outline: 'none',
        boxShadow: props.active ? 3 : 0,
        '&:focus-visible': { boxShadow: theme => `0 0 0 4px ${alpha(theme.palette.primary.main, 0.28)}` },
      }}
    >
      {src ? <Box component="img" alt="" draggable={false} src={src} sx={{ ...desktopWallpaperImageSx(props.preset.view), position: 'absolute', inset: 0, width: '100%', height: '100%' }} /> : null}
      <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.56))' }} />
      <Typography noWrap sx={{ position: 'absolute', left: 8, right: 40, bottom: 8, color: '#fff', fontWeight: 900, textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>{props.preset.name}</Typography>
      <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', top: 6, right: 6 }}>
        <IconButton size="small" aria-label={`调整取景：${props.preset.name}`} disabled={props.busy} onClick={event => { event.stopPropagation(); props.onEditView() }} sx={{ bgcolor: 'rgba(255,255,255,0.86)', '&:hover': { bgcolor: '#fff' } }}>
          <TuneRoundedIcon fontSize="inherit" />
        </IconButton>
        <IconButton size="small" color="error" aria-label={`删除壁纸：${props.preset.name}`} disabled={props.busy} onClick={event => { event.stopPropagation(); props.onRemove() }} sx={{ bgcolor: 'rgba(255,255,255,0.86)', '&:hover': { bgcolor: '#fff' } }}>
          <DeleteOutlineRoundedIcon fontSize="inherit" />
        </IconButton>
      </Stack>
    </Box>
  )
}

function useViewportAspect(): number {
  const [aspect, setAspect] = React.useState(() => currentViewportAspect())
  React.useEffect(() => {
    const update = () => setAspect(currentViewportAspect())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return aspect
}

function currentViewportAspect(): number {
  return Math.max(0.1, window.innerWidth / Math.max(1, window.innerHeight))
}
