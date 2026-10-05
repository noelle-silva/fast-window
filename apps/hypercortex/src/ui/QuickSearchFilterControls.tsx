import * as React from 'react'
import { Box, Typography } from '@mui/material'
import { unstyledButtonSurfaceSx } from './pluginUiStyles'
import { bytesToKbInput, dateInputToEndMs, dateInputToStartMs, kbInputToBytes, msToDateInput } from './quickSearchFilters'

export function FilterChip(props: { label: string; active: boolean; onClick: () => void }): React.ReactNode {
  const { label, active, onClick } = props
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        ...unstyledButtonSurfaceSx,
        px: 1,
        py: 0.4,
        borderRadius: 999,
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 900,
        color: active ? '#fff' : 'rgba(0,0,0,.6)',
        bgcolor: active ? 'var(--hc-primary)' : 'rgba(0,0,0,.05)',
        '&:hover': { bgcolor: active ? 'var(--hc-primary)' : 'rgba(0,0,0,.09)' },
      }}
    >
      {label}
    </Box>
  )
}

export function FilterRow(props: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap' }}>
      <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.42)', fontWeight: 900, flexShrink: 0 }}>{props.label}</Typography>
      {props.children}
    </Box>
  )
}

export const filterInputSx = {
  appearance: 'auto',
  WebkitAppearance: 'auto',
  border: 0,
  margin: 0,
  font: 'inherit',
  fontFamily: 'inherit',
  outline: 'none',
  px: 0.75,
  py: 0.4,
  borderRadius: 1.5,
  fontSize: 11,
  color: 'rgba(0,0,0,.68)',
  bgcolor: 'rgba(0,0,0,.05)',
  boxShadow: 'inset 0 0 0 1px transparent',
  '&:focus': { boxShadow: 'inset 0 0 0 1px var(--hc-primary)', bgcolor: 'var(--hc-surface)' },
} as const

export function DateRangeInputs(props: {
  from: number
  to: number
  onChange: (from: number, to: number) => void
}): React.ReactNode {
  const { from, to, onChange } = props
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box
        component="input"
        type="date"
        value={msToDateInput(from)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(dateInputToStartMs(e.target.value), to)}
        sx={filterInputSx}
      />
      <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.4)' }}>~</Typography>
      <Box
        component="input"
        type="date"
        value={msToDateInput(to)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(from, dateInputToEndMs(e.target.value))}
        sx={filterInputSx}
      />
    </Box>
  )
}

export function SizeRangeInputs(props: {
  from: number
  to: number
  onChange: (from: number, to: number) => void
}): React.ReactNode {
  const { from, to, onChange } = props
  const numberSx = { ...filterInputSx, width: 68 }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box
        component="input"
        type="number"
        min={0}
        placeholder="最小"
        value={bytesToKbInput(from)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(kbInputToBytes(e.target.value), to)}
        sx={numberSx}
      />
      <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.4)' }}>~</Typography>
      <Box
        component="input"
        type="number"
        min={0}
        placeholder="最大"
        value={bytesToKbInput(to)}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(from, kbInputToBytes(e.target.value))}
        sx={numberSx}
      />
      <Typography sx={{ fontSize: 11, color: 'rgba(0,0,0,.4)' }}>KB</Typography>
    </Box>
  )
}
