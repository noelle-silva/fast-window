import * as React from 'react'
import { Box, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, TextField } from '@mui/material'
import { InheritBadge } from './InheritBadge'
import type { CloseMode } from '../types'

const CLOSE_MODE_OPTIONS: Array<{ value: CloseMode; label: string; hint: string }> = [
  { value: 'keep-open', label: '保留窗口', hint: '命令执行完后窗口保持开启，手动关闭' },
  { value: 'countdown', label: '倒计时关闭', hint: '命令执行完后倒计时自动关闭' },
  { value: 'close-immediately', label: '立即关闭', hint: '命令执行完后窗口立即关闭' },
]

type CloseModeSelectProps = {
  closeMode: string
  countdownSeconds: number
  onChange: (next: { closeMode: string; countdownSeconds: number }) => void
  includeInherit?: boolean
  inheritLabel?: string
  /** 继承到的真实关闭策略：当 closeMode 为空（跟随上级）时，用于展示真实生效值。格式同 closeMode */
  effectiveMode?: string
  /** 继承到的真实倒计时秒数 */
  effectiveCountdown?: number
  disabled?: boolean
}

export function CloseModeSelect({ closeMode, countdownSeconds, onChange, includeInherit = false, inheritLabel = '跟随全局默认', effectiveMode = '', effectiveCountdown = 10, disabled = false }: CloseModeSelectProps) {
  const isInheriting = includeInherit && closeMode === '' && effectiveMode !== ''
  const effectiveLabel = effectiveMode === 'countdown'
    ? `${effectiveCountdown} 秒后自动关闭`
    : CLOSE_MODE_OPTIONS.find(option => option.value === effectiveMode)?.label ?? ''
  return (
    <FormControl disabled={disabled} fullWidth>
      <FormLabel sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary' }}>窗口关闭策略</FormLabel>
      <RadioGroup
        value={closeMode}
        onChange={event => onChange({ closeMode: event.target.value, countdownSeconds })}
        sx={{ mt: 1, gap: 1 }}
      >
        {includeInherit ? (
          <Box key="inherit" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <FormControlLabel
              value=""
              control={<Radio size="small" />}
              label={
                <Box sx={{ minWidth: 0 }}>
                  <Box component="span" sx={{ fontSize: 13, fontWeight: 700 }}>
                    {inheritLabel}{isInheriting ? ` · 当前：${effectiveLabel}` : ''}
                  </Box>
                  <Box component="span" sx={{ display: 'block', color: 'text.secondary', fontSize: 11 }}>继承所用命令的上级默认</Box>
                </Box>
              }
              sx={{ mr: 0, alignItems: 'flex-start' }}
            />
            {isInheriting ? <InheritBadge /> : null}
          </Box>
        ) : null}
        {CLOSE_MODE_OPTIONS.map(option => (
          <Box key={option.value} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <FormControlLabel
              value={option.value}
              control={<Radio size="small" />}
              label={
                <Box sx={{ minWidth: 0 }}>
                  <Box component="span" sx={{ fontSize: 13, fontWeight: 700 }}>{option.label}</Box>
                  <Box component="span" sx={{ display: 'block', color: 'text.secondary', fontSize: 11 }}>{option.hint}</Box>
                </Box>
              }
              sx={{ mr: 0, alignItems: 'flex-start' }}
            />
            {option.value === 'countdown' && closeMode === 'countdown' ? (
              <TextField
                type="number"
                size="small"
                label="秒数"
                value={countdownSeconds}
                disabled={disabled}
                onChange={event => onChange({ closeMode, countdownSeconds: Number(event.target.value) })}
                sx={{ width: 110 }}
                inputProps={{ min: 1, max: 3600 }}
              />
            ) : null}
          </Box>
        ))}
      </RadioGroup>
    </FormControl>
  )
}
