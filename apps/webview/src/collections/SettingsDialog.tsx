import * as React from 'react'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import SplitscreenRoundedIcon from '@mui/icons-material/SplitscreenRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  Paper,
  Slider,
  Stack,
  Typography,
  alpha,
} from '@mui/material'
import { DesktopWallpaperSettings } from './DesktopWallpaperSettings'
import { VideoSpeedSection } from './VideoSpeedSection'
import {
  DEFAULT_DESKTOP_ICON_LAYOUT,
  DESKTOP_ICON_GAP_MAX,
  DESKTOP_ICON_GAP_MIN,
  DESKTOP_ICON_GAP_STEP,
  DESKTOP_ICON_SCALE_MAX,
  DESKTOP_ICON_SCALE_MIN,
  DESKTOP_ICON_SCALE_STEP,
  normalizeDesktopIconLayout,
} from './folder-grid/iconLayout'
import type { DataDirStatus, DesktopIconLayout, DesktopWallpaperView, WorkspaceView } from './types'

export function SettingsDialog(props: {
  assetUrl?(assetId: string): string
  busy: boolean
  doc: WorkspaceView
  iconLayout: DesktopIconLayout
  open: boolean
  status: DataDirStatus | null
  onClearWallpaper(): void
  onClose(): void
  onPickDataDir(): void
  onPickWallpaper(): void
  onPreviewIconLayout(layout: DesktopIconLayout): void
  onRemoveWallpaperPreset(id: string): void
  onRestart(): void
  onSaveIconLayout(layout: DesktopIconLayout): void
  onSaveWallpaperPresetView(id: string, view: DesktopWallpaperView): void
  onSelectWallpaperPreset(id: string): void
}) {
  const iconLayout = normalizeDesktopIconLayout(props.iconLayout)
  const updateDraftIconLayout = (patch: Partial<DesktopIconLayout>) => props.onPreviewIconLayout(normalizeDesktopIconLayout({ ...iconLayout, ...patch }))
  const saveDraftIconLayout = (patch: Partial<DesktopIconLayout>) => props.onSaveIconLayout(normalizeDesktopIconLayout({ ...iconLayout, ...patch }))

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="md">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">设置</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>管理桌面图标、壁纸、视频倍速与数据目录。</Typography>
          </Box>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
            <Stack spacing={1.75}>
              <Box>
                <Typography fontWeight={900}>桌面图标布局</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>控制桌面图标之间的行列间距，以及图标整体显示大小。</Typography>
              </Box>
              <Box sx={{ display: 'grid', gap: 2 }}>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography fontWeight={800}>图标行间距</Typography>
                    <Chip size="small" label={`${iconLayout.rowGap}px`} />
                  </Stack>
                  <Slider
                    aria-label="图标行间距"
                    value={iconLayout.rowGap}
                    min={DESKTOP_ICON_GAP_MIN}
                    max={DESKTOP_ICON_GAP_MAX}
                    step={DESKTOP_ICON_GAP_STEP}
                    marks={[
                      { value: DESKTOP_ICON_GAP_MIN, label: `${DESKTOP_ICON_GAP_MIN}px` },
                      { value: DESKTOP_ICON_GAP_MAX, label: `${DESKTOP_ICON_GAP_MAX}px` },
                    ]}
                    valueLabelDisplay="auto"
                    valueLabelFormat={value => `${value}px`}
                    disabled={props.busy}
                    onChange={(_, value) => updateDraftIconLayout({ rowGap: Array.isArray(value) ? value[0] : value })}
                    onChangeCommitted={(_, value) => saveDraftIconLayout({ rowGap: Array.isArray(value) ? value[0] : value })}
                  />
                </Box>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography fontWeight={800}>图标列间距</Typography>
                    <Chip size="small" label={`${iconLayout.columnGap}px`} />
                  </Stack>
                  <Slider
                    aria-label="图标列间距"
                    value={iconLayout.columnGap}
                    min={DESKTOP_ICON_GAP_MIN}
                    max={DESKTOP_ICON_GAP_MAX}
                    step={DESKTOP_ICON_GAP_STEP}
                    marks={[
                      { value: DESKTOP_ICON_GAP_MIN, label: `${DESKTOP_ICON_GAP_MIN}px` },
                      { value: DESKTOP_ICON_GAP_MAX, label: `${DESKTOP_ICON_GAP_MAX}px` },
                    ]}
                    valueLabelDisplay="auto"
                    valueLabelFormat={value => `${value}px`}
                    disabled={props.busy}
                    onChange={(_, value) => updateDraftIconLayout({ columnGap: Array.isArray(value) ? value[0] : value })}
                    onChangeCommitted={(_, value) => saveDraftIconLayout({ columnGap: Array.isArray(value) ? value[0] : value })}
                  />
                </Box>
                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography fontWeight={800}>图标大小缩放</Typography>
                    <Chip size="small" label={`${Math.round(iconLayout.iconScale * 100)}%`} />
                  </Stack>
                  <Slider
                    aria-label="图标大小缩放"
                    value={iconLayout.iconScale}
                    min={DESKTOP_ICON_SCALE_MIN}
                    max={DESKTOP_ICON_SCALE_MAX}
                    step={DESKTOP_ICON_SCALE_STEP}
                    marks={[
                      { value: DESKTOP_ICON_SCALE_MIN, label: `${Math.round(DESKTOP_ICON_SCALE_MIN * 100)}%` },
                      { value: 1, label: '100%' },
                      { value: DESKTOP_ICON_SCALE_MAX, label: `${Math.round(DESKTOP_ICON_SCALE_MAX * 100)}%` },
                    ]}
                    valueLabelDisplay="auto"
                    valueLabelFormat={value => `${Math.round(value * 100)}%`}
                    disabled={props.busy}
                    onChange={(_, value) => updateDraftIconLayout({ iconScale: Array.isArray(value) ? value[0] : value })}
                    onChangeCommitted={(_, value) => saveDraftIconLayout({ iconScale: Array.isArray(value) ? value[0] : value })}
                  />
                </Box>
              </Box>
              <Stack direction="row" justifyContent="flex-end">
                <Button
                  startIcon={<RestartAltRoundedIcon />}
                  onClick={() => {
                    props.onPreviewIconLayout(DEFAULT_DESKTOP_ICON_LAYOUT)
                    props.onSaveIconLayout(DEFAULT_DESKTOP_ICON_LAYOUT)
                  }}
                  disabled={props.busy}
                >
                  恢复默认图标布局
                </Button>
              </Stack>
            </Stack>
          </Paper>
          <DesktopWallpaperSettings
            assetUrl={props.assetUrl}
            busy={props.busy}
            wallpaper={props.doc.desktop.wallpaper}
            onAddWallpaper={props.onPickWallpaper}
            onClearWallpaper={props.onClearWallpaper}
            onRemovePreset={props.onRemoveWallpaperPreset}
            onSavePresetView={props.onSaveWallpaperPresetView}
            onSelectPreset={props.onSelectWallpaperPreset}
          />
          <VideoSpeedSection />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
            <InfoBlock label="当前数据目录" value={props.status?.dataDir || '读取中'} mono />
            <InfoBlock label="默认数据目录" value={props.status?.defaultDataDir || '读取中'} mono />
            <InfoBlock label="数据版本" value={`${props.doc.schemaVersion} / ${props.doc.dataVersion}`} />
            <InfoBlock label="可写状态" value={props.status?.writable ? '可写' : '不可写或未知'} />
          </Box>
          {props.status?.error ? <Alert severity="error" sx={{ mt: 2 }}>{props.status.error}</Alert> : null}
          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap">
            <Button startIcon={<SplitscreenRoundedIcon />} onClick={props.onPickDataDir} disabled={props.busy}>选择数据目录</Button>
            <Button variant="contained" onClick={props.onClose}>完成</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

function InfoBlock(props: { label: string; value: string; mono?: boolean }) {
  return (
    <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2.5, minWidth: 0, bgcolor: theme => alpha(theme.palette.primary.main, 0.06) }}>
      <Typography variant="caption" color="text.secondary">{props.label}</Typography>
      <Typography sx={{ mt: 0.5, overflowWrap: 'anywhere', fontFamily: props.mono ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : undefined }}>{props.value}</Typography>
    </Paper>
  )
}
