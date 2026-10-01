import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SaveIcon from '@mui/icons-material/Save'
import {
  COLOR_THEME_BUILTIN_PRESETS,
  isColorThemePresetDirty,
  listColorThemePresets,
  resolveColorThemePreset,
  type ColorThemeDraft,
  type ColorThemePreset,
} from '../../domain/colorTheme'
import { ColorThemeSwatchGrid } from './ColorThemeSwatchGrid'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { SettingsPill, SettingsSection } from './SettingsSurfaces'

const BUILTIN_PRESET_IDS = new Set(COLOR_THEME_BUILTIN_PRESETS.map((preset) => preset.id))

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

export function ColorThemeSettingsSection(props: { controller: any; loading: boolean; settings: any; draft: any }) {
  const { controller, loading, settings, draft } = props
  const colorThemeDraft = (draft?.colorThemeDraft as ColorThemeDraft | null | undefined) || null
  const presets = colorThemeDraft ? colorThemeDraft.presets : listColorThemePresets(settings?.colorTheme)
  const activeId = colorThemeDraft ? colorThemeDraft.activePresetId : resolveColorThemePreset(settings?.colorTheme).id
  const selected = presets.find((preset) => preset.id === activeId) || presets[0]
  const dirty = isColorThemePresetDirty(settings?.colorTheme, colorThemeDraft, selected?.id || '')
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

  if (!selected) return null

  return (
    <SettingsSection>
      <Stack spacing={1.5}>
        <Box>
          <Typography sx={{ fontWeight: 900 }}>配色预设</Typography>
          <Typography variant="caption" color="text.secondary">
            左侧选择预设，右侧调整颜色；改动实时预览，点保存后生效。内置预设被修改时会生成副本，原版保持不变。
          </Typography>
        </Box>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems="stretch">
          <Stack spacing={0.75} sx={{ width: { xs: '100%', md: 228 }, flexShrink: 0 }}>
            <CustomScrollArea hostSx={{ maxHeight: { xs: 220, md: 420 } }} scrollSx={{ maxHeight: { xs: 220, md: 420 } }}>
              <Stack spacing={0.75} sx={{ pr: 0.5 }}>
                {presets.map((preset) => {
                  const active = preset.id === activeId
                  return (
                    <Button
                      key={preset.id}
                      variant={active ? 'contained' : 'text'}
                      color={active ? 'primary' : 'inherit'}
                      disabled={loading}
                      onClick={() => controller.actions.selectColorThemeDraftPreset?.(preset.id)}
                      sx={{ justifyContent: 'flex-start', minWidth: 0, px: 1, textTransform: 'none', textAlign: 'left' }}
                    >
                      <Box
                        sx={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          bgcolor: preset.colors.primary,
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.14)',
                          flexShrink: 0,
                        }}
                      />
                      <Box component="span" sx={{ ml: 1, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 800 }}>
                        {preset.name}
                      </Box>
                      {BUILTIN_PRESET_IDS.has(preset.id) ? <SettingsPill>内置</SettingsPill> : null}
                    </Button>
                  )
                })}
              </Stack>
            </CustomScrollArea>
            <Button
              startIcon={<AddIcon />}
              variant="text"
              color="inherit"
              disabled={loading}
              onClick={() => controller.actions.addColorThemeDraftPreset?.()}
              sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
            >
              新增预设
            </Button>
          </Stack>

          <Stack spacing={1.25} sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <TextField
                size="small"
                label="预设名称"
                value={selected.name}
                onChange={(event) => controller.actions.renameColorThemeDraftPreset?.(selected.id, event.target.value)}
                disabled={loading}
                sx={{ flex: 1, minWidth: 0 }}
              />
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                <SettingsPill>{selected.mode === 'dark' ? '深色' : '浅色'}</SettingsPill>
                <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                  <Button
                    startIcon={<SaveIcon />}
                    variant="contained"
                    size="small"
                    disabled={loading || !dirty}
                    onClick={() => controller.actions.saveColorThemeDraftPreset?.(selected.id)}
                  >
                    {dirty ? '保存' : '已保存'}
                  </Button>
                  {dirty ? (
                    <Tooltip title="有未保存的修改">
                      <Box
                        sx={{
                          position: 'absolute',
                          top: -3,
                          right: -3,
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: 'warning.main',
                          boxShadow: '0 0 0 2px var(--studio-field)',
                          pointerEvents: 'none',
                        }}
                      />
                    </Tooltip>
                  ) : null}
                </Box>
              </Stack>
            </Stack>

            {selected.description ? (
              <Typography variant="caption" color="text.secondary">
                {selected.description}
              </Typography>
            ) : null}

            <ColorThemeSwatchGrid
              colors={selected.colors}
              disabled={loading}
              onChange={(key, value) => controller.actions.updateColorThemeDraftColor?.(selected.id, key, value)}
            />

            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Button variant="contained" onClick={openImportDialog} disabled={loading}>
                导入配色 JSON
              </Button>
            </Stack>
          </Stack>
        </Stack>

        <Dialog open={importDialogOpen} onClose={closeImportDialog} fullWidth maxWidth="md">
          <DialogTitle>导入配色 JSON</DialogTitle>
          <DialogContent>
            <Stack spacing={1.25} sx={{ pt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                粘贴单个配色对象，或包含 presets 数组的一组配色。导入会先加入草稿，保存后才正式生效。
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
            <Button onClick={() => setImportText(serializePreset(selected))} disabled={loading}>
              填入当前结构
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={closeImportDialog}>取消</Button>
            <Button variant="contained" onClick={handleImport} disabled={loading}>
              导入到草稿
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </SettingsSection>
  )
}
