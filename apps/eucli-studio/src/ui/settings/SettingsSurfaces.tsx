import * as React from 'react'
import { Box, Paper, type SxProps, type Theme } from '@mui/material'

type SurfaceTone = 'default' | 'muted' | 'selected' | 'danger' | 'info'

type SurfaceProps = {
  children: React.ReactNode
  sx?: SxProps<Theme>
  style?: React.CSSProperties
}

type SectionProps = SurfaceProps & {
  tone?: SurfaceTone
}

function sxList(sx?: SxProps<Theme>) {
  if (!sx) return []
  return Array.isArray(sx) ? sx : [sx]
}

function toneBackground(tone: SurfaceTone) {
  if (tone === 'selected') return 'var(--studio-primary-soft)'
  if (tone === 'danger') return 'color-mix(in srgb, var(--studio-danger) 10%, transparent)'
  if (tone === 'info') return 'var(--studio-secondary-soft)'
  if (tone === 'muted') return 'var(--studio-paper-muted)'
  return 'var(--studio-field)'
}

const settingsFormControlSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: 2,
    bgcolor: 'var(--studio-field)',
    boxShadow: 'var(--studio-shadow-soft)',
    transition: 'background-color .16s ease, box-shadow .16s ease',
    '& .MuiOutlinedInput-notchedOutline': { border: 0 },
    '&:hover': {
      bgcolor: 'var(--studio-field-hover)',
      boxShadow: 'var(--studio-shadow-soft)',
    },
    '&:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
    '&.Mui-focused': {
      bgcolor: 'var(--studio-field-focus)',
      boxShadow: 'var(--studio-focus)',
    },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
    '&.Mui-disabled': {
      bgcolor: 'var(--studio-paper-muted)',
      boxShadow: 'none',
    },
    '&.Mui-disabled .MuiOutlinedInput-notchedOutline': { border: 0 },
  },
  '& .MuiInputLabel-root': {
    color: 'text.secondary',
    fontWeight: 700,
  },
  '& .MuiInputLabel-root.Mui-focused': {
    color: 'primary.main',
  },
  '& .MuiFormHelperText-root': {
    mx: 0.5,
  },
  '& .MuiSelect-icon': {
    color: 'text.secondary',
  },
}

export function SettingsSurface(props: SurfaceProps) {
  return (
    <Paper
      elevation={0}
      sx={[
        {
          p: { xs: 1.5, sm: 1.75 },
          borderRadius: 3,
          color: 'var(--studio-text-primary)',
          bgcolor: 'var(--studio-field)',
          backgroundImage: 'none',
          boxShadow: 'var(--studio-shadow-strong)',
          ...settingsFormControlSx,
        },
        ...sxList(props.sx),
      ]}
    >
      {props.children}
    </Paper>
  )
}

export const SettingsSection = React.forwardRef<HTMLDivElement, SectionProps>(function SettingsSection(props, ref) {
  const tone = props.tone || 'default'
  return (
    <Box
      ref={ref}
      style={props.style}
      sx={[
        {
          p: { xs: 1.25, sm: 1.5 },
          borderRadius: 2.5,
          bgcolor: toneBackground(tone),
          boxShadow: tone === 'selected' ? 'var(--studio-focus)' : 'var(--studio-shadow-soft)',
          ...settingsFormControlSx,
        },
        ...sxList(props.sx),
      ]}
    >
      {props.children}
    </Box>
  )
})

export const SettingsListItem = React.forwardRef<HTMLDivElement, SectionProps>(function SettingsListItem(props, ref) {
  return <SettingsSection ref={ref} tone={props.tone || 'default'} sx={[{ p: 1.25 }, ...sxList(props.sx)]}>{props.children}</SettingsSection>
})

export function SettingsPill(props: { children: React.ReactNode; tone?: SurfaceTone; sx?: SxProps<Theme> }) {
  return (
    <Box
      component="span"
      sx={[
        {
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: 24,
          px: 1,
          borderRadius: 999,
          bgcolor: toneBackground(props.tone || 'muted'),
          color: props.tone === 'danger' ? 'error.main' : props.tone === 'selected' ? 'primary.main' : 'text.secondary',
          fontSize: 12,
          fontWeight: 800,
          lineHeight: 1,
        },
        ...sxList(props.sx),
      ]}
    >
      {props.children}
    </Box>
  )
}
