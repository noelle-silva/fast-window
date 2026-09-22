import * as React from 'react'
import { Box, Button, IconButton, Switch, Stack, Typography } from '@mui/material'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong'
import CloseIcon from '@mui/icons-material/Close'
import { normalizeWallpaperSettings, wallpaperVeilAlpha, type WallpaperPreset } from '../../domain/wallpaper'
import { colorMixVar } from '../colorThemeStyles'
import { useEvent } from '../hooks/useEvent'
import { clampNum } from '../utils/numbers'
import { clearWallpaperImage, useWallpaperImage } from '../wallpaper/useWallpaperImage'
import { SettingsPill, SettingsSection } from './SettingsSurfaces'
import { WallpaperViewEditorDialog } from './WallpaperViewEditorDialog'

export function WallpaperSettingsSection(props: { controller: any; loading: boolean; settings: any }) {
  const { controller, loading, settings } = props
  const wallpaper = normalizeWallpaperSettings(settings?.wallpaper)
  const [editorOpen, setEditorOpen] = React.useState(false)
  const activePreset = wallpaper.presets.find((preset) => preset.id === wallpaper.activeId) || null
  const activeSrc = useWallpaperImage(controller, activePreset?.relPath || '')
  const canEnable = wallpaper.presets.length > 0
  const chatBgBlur = clampNum(Number(settings?.chatBgBlur ?? 0), 0, 24)
  const veilPercent = Math.max(1, wallpaperVeilAlpha(settings?.chatBgOpacity, settings?.chatBgBlur) * 100)

  const toggleEnabled = useEvent(() => controller.actions.setWallpaperEnabled?.(!wallpaper.enabled))
  const pickWallpaper = useEvent(() => controller.actions.addWallpaperFromPicker?.())
  const selectWallpaper = useEvent((id: string) => controller.actions.setActiveWallpaper?.(id))
  const removeWallpaper = useEvent(async (preset: WallpaperPreset) => {
    await controller.actions.removeWallpaper?.(preset.id)
    clearWallpaperImage(preset.relPath)
  })

  return (
    <SettingsSection>
      <Stack spacing={1.25}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>壁纸</Typography>
          <SettingsPill tone={activePreset ? 'info' : 'muted'}>
            {activePreset ? `${wallpaper.presets.length} 张预设` : '暂无预设'}
          </SettingsPill>
          <Box sx={{ flex: 1 }} />
          <Switch size="small" checked={wallpaper.enabled} onChange={toggleEnabled} disabled={loading || !canEnable} />
          <Typography variant="body2" color="text.secondary">
            启用壁纸
          </Typography>
        </Stack>

        <Box sx={{ position: 'relative', height: 120, borderRadius: 2, overflow: 'hidden', bgcolor: 'var(--studio-paper-muted)', boxShadow: 'var(--studio-shadow-soft)' }}>
          {activePreset && activeSrc ? (
            <>
              <Box
                component="img"
                src={activeSrc}
                alt="壁纸预览"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: `${activePreset.view.x}% ${activePreset.view.y}%`,
                  transform: `scale(${activePreset.view.scale * 1.05})`,
                  transformOrigin: `${activePreset.view.x}% ${activePreset.view.y}%`,
                  display: 'block',
                }}
              />
              {wallpaper.enabled ? (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    bgcolor: colorMixVar('--studio-canvas', veilPercent),
                    backdropFilter: chatBgBlur > 0 ? `blur(${chatBgBlur}px)` : 'none',
                    WebkitBackdropFilter: chatBgBlur > 0 ? `blur(${chatBgBlur}px)` : 'none',
                  }}
                />
              ) : null}
            </>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              添加壁纸后在这里预览
            </Typography>
          )}
        </Box>

        {wallpaper.presets.length ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {wallpaper.presets.map((preset) => (
              <WallpaperPresetCard
                key={preset.id}
                controller={controller}
                preset={preset}
                active={preset.id === wallpaper.activeId}
                disabled={loading}
                onSelect={() => selectWallpaper(preset.id)}
                onRemove={() => void removeWallpaper(preset)}
              />
            ))}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            还没有壁纸，先添加一张。
          </Typography>
        )}

        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" startIcon={<AddPhotoAlternateIcon />} onClick={pickWallpaper} disabled={loading}>
            添加壁纸
          </Button>
          <Button size="small" variant="text" startIcon={<CenterFocusStrongIcon />} onClick={() => setEditorOpen(true)} disabled={loading || !activePreset}>
            调整取景
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary">
          启用壁纸后聊天背景自动按透明模式渲染，下方「组件调节」直接作用在壁纸上。
        </Typography>
      </Stack>

      <WallpaperViewEditorDialog open={editorOpen} controller={controller} preset={activePreset} onClose={() => setEditorOpen(false)} />
    </SettingsSection>
  )
}

function WallpaperPresetCard(props: {
  controller: any
  preset: WallpaperPreset
  active: boolean
  disabled: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const { controller, preset, active, disabled, onSelect, onRemove } = props
  const src = useWallpaperImage(controller, preset.relPath)

  return (
    <Box
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="切换壁纸"
      aria-pressed={active}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect()
      }}
      sx={{
        position: 'relative',
        width: 96,
        height: 60,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'var(--studio-paper-muted)',
        boxShadow: active ? 'var(--studio-focus)' : 'var(--studio-shadow-soft)',
        outline: active ? '2px solid var(--studio-primary)' : '1px solid var(--studio-border)',
        outlineOffset: active ? 0 : -1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {src ? (
        <Box
          component="img"
          src={src}
          alt=""
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: `${preset.view.x}% ${preset.view.y}%`,
            display: 'block',
          }}
        />
      ) : null}
      <IconButton
        size="small"
        aria-label="删除壁纸"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        disabled={disabled}
        sx={{
          position: 'absolute',
          top: 2,
          right: 2,
          color: '#fff',
          bgcolor: 'rgba(15,23,42,.46)',
          '&:hover': { bgcolor: 'rgba(15,23,42,.68)' },
        }}
      >
        <CloseIcon sx={{ fontSize: 15 }} />
      </IconButton>
    </Box>
  )
}
