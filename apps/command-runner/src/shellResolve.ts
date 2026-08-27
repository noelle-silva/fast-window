import type { AppSettings, CommandItem, CloseMode, ShellInfo } from './types'

const CLOSE_MODE_LABELS: Record<CloseMode, string> = {
  'keep-open': '执行完保留窗口',
  countdown: '倒计时后自动关闭',
  'close-immediately': '执行完立即关闭',
}

export function resolveShellInfo(
  commandShellId: string,
  repoShellId: string,
  settings: AppSettings | null,
  shells: ShellInfo[],
): ShellInfo | undefined {
  const byId = (id: string) => shells.find(shell => shell.id === id)
  const chain = [
    commandShellId,
    repoShellId,
    settings?.defaultShellId || '',
    'cmd',
  ]
  for (const id of chain) {
    if (!id) continue
    const info = byId(id)
    if (info) return info
  }
  return undefined
}

export function resolveCloseMode(command: CommandItem, settings: AppSettings | null): CloseMode {
  const mode = command.closeMode || settings?.defaultCloseMode || ''
  if (mode === 'countdown' || mode === 'close-immediately') return mode
  return 'keep-open'
}

export function resolveCountdownSeconds(command: CommandItem, settings: AppSettings | null): number {
  if (command.countdownSeconds > 0) return command.countdownSeconds
  if (settings && settings.defaultCountdownSeconds > 0) return settings.defaultCountdownSeconds
  return 10
}

export function closeModeLabel(mode: CloseMode, countdownSeconds: number): string {
  if (mode === 'countdown') return `${countdownSeconds} 秒后自动关闭`
  return CLOSE_MODE_LABELS[mode]
}

export function shellTierLabel(
  commandShellId: string,
  repoShellId: string,
): '命令' | '仓库' | '全局' {
  if (commandShellId) return '命令'
  if (repoShellId) return '仓库'
  return '全局'
}
