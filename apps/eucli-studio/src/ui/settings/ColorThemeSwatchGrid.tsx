import * as React from 'react'
import { Box, Popover, Stack, Typography } from '@mui/material'
import { RgbaColorPicker } from 'react-colorful'
import { COLOR_THEME_COLOR_KEYS, type ColorThemeColors } from '../../domain/colorTheme'
import { formatCssColor, parseCssColor } from '../../domain/cssColor'

// 颜色自定义的色块网格：纯颜色可点击弹出取色器（实时写回草稿）；阴影类值只读预览。
const MONO_FONT = 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace'

export function ColorThemeSwatchGrid(props: {
  colors: ColorThemeColors
  disabled?: boolean
  onChange: (key: keyof ColorThemeColors, value: string) => void
}) {
  const { colors, disabled, onChange } = props
  const [picker, setPicker] = React.useState<{ key: keyof ColorThemeColors; anchorEl: HTMLElement } | null>(null)

  const closePicker = () => setPicker(null)
  const pickerColor = picker ? parseCssColor(colors[picker.key]) : null

  const openPicker = (key: keyof ColorThemeColors, anchorEl: HTMLElement) => {
    if (disabled) return
    setPicker({ key, anchorEl })
  }

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))', gap: 1 }}>
        {COLOR_THEME_COLOR_KEYS.map((key) => {
          const raw = String(colors[key] ?? '')
          const parsed = parseCssColor(raw)
          const editable = !!parsed && !disabled
          return (
            <Box key={key} sx={{ minWidth: 0 }}>
              <Box
                role={parsed ? 'button' : undefined}
                tabIndex={editable ? 0 : undefined}
                aria-label={parsed ? `${key} ${raw}` : undefined}
                onClick={editable ? (event) => openPicker(key, event.currentTarget) : undefined}
                onKeyDown={
                  editable
                    ? (event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        openPicker(key, event.currentTarget)
                      }
                    : undefined
                }
                sx={{
                  height: 34,
                  borderRadius: 1.5,
                  bgcolor: parsed ? raw : 'transparent',
                  boxShadow: parsed ? 'inset 0 0 0 1px var(--studio-border)' : 'none',
                  cursor: editable ? 'pointer' : 'default',
                  transition: 'box-shadow .16s ease',
                  '&:hover': editable ? { boxShadow: 'inset 0 0 0 2px var(--studio-primary)' } : undefined,
                  '&:focus-visible': { outline: '2px solid var(--studio-primary)', outlineOffset: 2 },
                }}
              >
                {!parsed ? (
                  <Box sx={{ height: '100%', borderRadius: 1.5, bgcolor: 'var(--studio-paper)', boxShadow: raw }} />
                ) : null}
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                title={raw}
                sx={{ display: 'block', fontFamily: MONO_FONT, fontSize: 10.5, mt: 0.25 }}
              >
                {raw}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap title={key} sx={{ display: 'block', fontSize: 10.5, opacity: 0.72 }}>
                {key}
              </Typography>
            </Box>
          )
        })}
      </Box>

      <Popover
        open={!!picker && !!pickerColor}
        anchorEl={picker?.anchorEl}
        onClose={closePicker}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { borderRadius: 3, p: 1.5, mt: 0.5 } } }}
      >
        {picker && pickerColor ? (
          <Stack spacing={1} sx={{ width: 236 }}>
            <RgbaColorPicker
              color={pickerColor}
              onChange={(color) => onChange(picker.key, formatCssColor(color))}
              style={{ width: '100%' }}
            />
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Typography variant="caption" sx={{ fontFamily: MONO_FONT }} noWrap title={String(colors[picker.key] ?? '')}>
                {String(colors[picker.key] ?? '')}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {picker.key}
              </Typography>
            </Stack>
          </Stack>
        ) : null}
      </Popover>
    </Box>
  )
}
