import type { SpaceEntry } from './executionSpace'

export function entryStatusLabel(entry: SpaceEntry): string {
  if (entry.status === 'running') return '运行中'
  if (entry.exitCode === 0) return '已完成'
  return `已结束（退出码 ${entry.exitCode ?? '未知'}）`
}

export function entryStatusDotClass(entry: SpaceEntry): string {
  return `cr-run-dot ${entry.status === 'running' ? 'cr-run-dot-running' : 'cr-run-dot-ended'}`
}
