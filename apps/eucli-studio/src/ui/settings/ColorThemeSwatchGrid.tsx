import * as React from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { DependablePopover } from '../components/DependablePopover'
import { RgbaColorPicker } from 'react-colorful'
import { BASE_COLOR_KEYS, type BaseColors } from '../../domain/colorTheme'
import { formatCssColor, parseCssColor } from '../../domain/cssColor'

// 基础色编辑网格：只显示用户可调的 10 个基础色
const MONO_FONT = 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace'

const BASE_COLOR_LABELS: Record<keyof BaseColors, string> = {
  background: '应用底色',
  surface: '通用表面',
  surfaceCode: '代码块表面',
  primary: '主强调色',
  secondary: '次强调色',
  text: '主文字色',
  border: '边框色',
  success: '成功状态',
  warning: '警告状态',
  danger: '危险状态',
}

export function ColorThemeSwatchGrid(props: {
  colors: BaseColors
  disabled?: boolean
  onChange: (key: keyof BaseColors, value: string) => void
}) {
  const { colors, disabled, onChange } = props
  const [picker, setPicker] = React.useState<{ key: keyof BaseColors; anchorEl: HTMLElement } | null>(null)

  const closePicker = () => setPicker(null)
  const pickerColor = picker ? parseCssColor(colors[picker.key] || '') : null

  const openPicker = (key: keyof BaseColors, anchorEl: HTMLElement) => {
    if (disabled) return
    setPicker({ key, anchorEl })
  }

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 }}>
        {BASE_COLOR_KEYS.map((key) => {
          const raw = String(colors[key] ?? '')
          const parsed = parseCssColor(raw)
          const editable = !!parsed && !disabled
          return (
            <Box key={key} sx={{ minWidth: 0 }}>
              <Box
                role={parsed ? 'button' : undefined}
                tabIndex={editable ? 0 : undefined}
                aria-label={parsed ? `${BASE_COLOR_LABELS[key]} ${raw}` : undefined}
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
                  height: 48,
                  borderRadius: 1.5,
                  bgcolor: parsed ? raw : 'var(--studio-paper-muted)',
                  boxShadow: parsed ? 'inset 0 0 0 1px var(--studio-border)' : 'none',
                  cursor: editable ? 'pointer' : 'default',
                  transition: 'box-shadow .16s ease',
                  '&:hover': editable ? { boxShadow: 'inset 0 0 0 2px var(--studio-primary)' } : undefined,
                  '&:focus-visible': { outline: '2px solid var(--studio-primary)', outlineOffset: 2 },
                }}
              />
              <Typography
                variant="caption"
                color="text.primary"
                noWrap
                title={BASE_COLOR_LABELS[key]}
                sx={{ display: 'block', fontSize: 11, mt: 0.5, fontWeight: 700 }}
              >
                {BASE_COLOR_LABELS[key]}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                title={raw}
                sx={{ display: 'block', fontFamily: MONO_FONT, fontSize: 10, opacity: 0.72 }}
              >
                {raw}
              </Typography>
            </Box>
          )
        })}
      </Box>

      <DependablePopover
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
                {BASE_COLOR_LABELS[picker.key]}
              </Typography>
            </Stack>
          </Stack>
        ) : null}
      </DependablePopover>
    </Box>
  )
}
