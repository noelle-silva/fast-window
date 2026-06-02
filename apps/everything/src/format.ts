import type { AppPhase, SetupMode } from './types'

export function modeLabel(mode?: SetupMode) {
  if (mode === 'global') return '全局索引'
  return '未配置'
}

export function phaseLabel(phase: AppPhase) {
  if (phase === 'ready') return 'Ready'
  if (phase === 'failed') return 'Needs attention'
  return 'Starting'
}

export function formatSize(raw: string) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return raw || '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}
