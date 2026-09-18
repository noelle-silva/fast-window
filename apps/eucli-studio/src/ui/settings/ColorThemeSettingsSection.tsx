import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import { COLOR_THEME_COLOR_KEYS, listColorThemePresets, resolveColorThemePreset, type ColorThemePreset } from '../../domain/colorTheme'
import { SettingsPill, SettingsSection } from './SettingsSurfaces'

function serializePreset(preset: ColorThemePreset) {
  return JSON.stringify(
    {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      mode: preset.mode,
      colors: preset.colors,
    },
    null,
    2,
  )
}

export function ColorThemeSettingsSection(props: { controller: any; loading: boolean; settings: any }) {
  const { controller, loading, settings } = props
  const presets = listColorThemePresets(settings?.colorTheme)
  const activePreset = resolveColorThemePreset(settings?.colorTheme)
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  const [importText, setImportText] = React.useState('')

  const openImportDialog = () => {
    setImportText('')
    setImportDialogOpen(true)
  }

  const closeImportDialog = () => {
    setImportDialogOpen(false)
    setImportText('')
  }

  const handleImport = () => {
    const text = String(importText || '').trim()
    if (!text) {
      controller?.capabilities?.ui?.showToast?.('请先粘贴配色 JSON', { kind: 'error' })
      return
    }
    const imported = controller.actions.importColorThemePresets?.(text)
    if (imported === true) closeImportDialog()
  }

  return (
    <SettingsSection>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 900 }}>配色预设</Typography>
              <SettingsPill>{activePreset.mode === 'dark' ? '深色' : '浅色'}</SettingsPill>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              选择内置或导入的配色方案，客户端主要界面会立即跟随当前方案刷新。
            </Typography>
          </Box>
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
            <InputLabel id="color-theme-preset-label">当前配色</InputLabel>
            <Select
              labelId="color-theme-preset-label"
              label="当前配色"
              value={activePreset.id}
              onChange={(event) => controller.actions.setColorThemePreset?.(String(event.target.value || ''))}
              disabled={loading}
            >
              {presets.map((preset) => (
                <MenuItem key={preset.id} value={preset.id}>
                  {preset.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
            gap: 1,
          }}
        >
          {COLOR_THEME_COLOR_KEYS.slice(0, 12).map((key) => (
            <Box key={key} sx={{ minWidth: 0 }}>
              <Box sx={{ height: 28, borderRadius: 1.5, bgcolor: activePreset.colors[key], boxShadow: 'inset 0 0 0 1px var(--studio-border)' }} />
              <Typography variant="caption" color="text.secondary" noWrap>
                {key}
              </Typography>
            </Box>
          ))}
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={openImportDialog} disabled={loading}>
            导入配色 JSON
          </Button>
        </Stack>

        <Dialog open={importDialogOpen} onClose={closeImportDialog} fullWidth maxWidth="md">
          <DialogTitle>导入配色 JSON</DialogTitle>
          <DialogContent>
            <Stack spacing={1.25} sx={{ pt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                粘贴单个配色对象，或包含 presets 数组的一组配色。导入成功后会自动切换到导入的第一个预设。
              </Typography>
              <TextField
                label="配色 JSON"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                multiline
                minRows={12}
                autoFocus
                disabled={loading}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setImportText(serializePreset(activePreset))} disabled={loading}>
              填入当前结构
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={closeImportDialog}>取消</Button>
            <Button variant="contained" onClick={handleImport} disabled={loading}>
              导入并切换
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </SettingsSection>
  )
}
