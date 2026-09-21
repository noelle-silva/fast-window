import * as React from 'react'
import { Chip } from '@mui/material'

export type ErrorKindStyle = {
  label: string
  color: string
  bg: string
}

export function errorKindStyle(codeRaw: string): ErrorKindStyle {
  const code = String(codeRaw || '').trim()
  if (!code) return { label: '原始原因', color: '#64748b', bg: 'rgba(100,116,139,.08)' }
  if (code.startsWith('network.')) return { label: '网络异常', color: '#d97706', bg: 'rgba(217,119,6,.08)' }
  if (code === 'provider.service_failed') return { label: '上游返回', color: '#2563eb', bg: 'rgba(37,99,235,.08)' }
  if (code.startsWith('provider.')) return { label: '模型请求', color: '#7c3aed', bg: 'rgba(124,58,237,.08)' }
  if (code.startsWith('runtime.')) return { label: '运行阶段', color: '#475569', bg: 'rgba(71,85,105,.08)' }
  if (code.startsWith('gateway.')) return { label: '网关阶段', color: '#475569', bg: 'rgba(71,85,105,.08)' }
  if (code.startsWith('storage.')) return { label: '存储异常', color: '#dc2626', bg: 'rgba(220,38,38,.08)' }
  return { label: '内部错误', color: '#dc2626', bg: 'rgba(220,38,38,.08)' }
}

export function ErrorKindChip(props: { code?: string }) {
  const kind = errorKindStyle(props.code || '')
  return (
    <Chip
      label={kind.label}
      size="small"
      sx={{ height: 20, fontSize: 11, fontWeight: 900, color: kind.color, bgcolor: 'rgba(255,255,255,.72)' }}
    />
  )
}
