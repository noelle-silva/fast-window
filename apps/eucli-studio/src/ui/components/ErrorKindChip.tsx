import * as React from 'react'
import { Chip } from '@mui/material'

export type ErrorKindStyle = {
  label: string
  colorVar: string
  bgVar: string
}

export function errorKindStyle(codeRaw: string): ErrorKindStyle {
  const code = String(codeRaw || '').trim()
  if (!code) return { label: '原始原因', colorVar: 'var(--studio-text-secondary)', bgVar: 'var(--studio-paper-muted)' }
  if (code.startsWith('network.')) return { label: '网络异常', colorVar: 'var(--studio-warning-text)', bgVar: 'var(--studio-warning-bg)' }
  if (code === 'provider.service_failed') return { label: '上游返回', colorVar: 'var(--studio-primary)', bgVar: 'var(--studio-primary-soft)' }
  if (code.startsWith('provider.')) return { label: '模型请求', colorVar: 'var(--studio-secondary)', bgVar: 'var(--studio-secondary-soft)' }
  if (code.startsWith('runtime.')) return { label: '运行阶段', colorVar: 'var(--studio-text-secondary)', bgVar: 'var(--studio-paper-muted)' }
  if (code.startsWith('gateway.')) return { label: '网关阶段', colorVar: 'var(--studio-text-secondary)', bgVar: 'var(--studio-paper-muted)' }
  if (code.startsWith('storage.')) return { label: '存储异常', colorVar: 'var(--studio-danger-text)', bgVar: 'var(--studio-danger-bg)' }
  return { label: '内部错误', colorVar: 'var(--studio-danger-text)', bgVar: 'var(--studio-danger-bg)' }
}

export function ErrorKindChip(props: { code?: string }) {
  const kind = errorKindStyle(props.code || '')
  return (
    <Chip
      label={kind.label}
      size="small"
      sx={{ height: 20, fontSize: 11, fontWeight: 900, color: kind.colorVar, bgcolor: kind.bgVar }}
    />
  )
}
