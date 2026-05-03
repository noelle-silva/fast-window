import { invoke } from '@tauri-apps/api/core'

const modifierCodes = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
])

export function buildShortcutFromEvent(e: KeyboardEvent): string | null {
  const code = typeof e.code === 'string' ? e.code : ''
  if (!code || code === 'Unidentified') return null
  if (modifierCodes.has(code)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('control')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey) parts.push('super')
  parts.push(code)
  return parts.join('+')
}

const recordingGuardCommands = [
  ['pause_wake_shortcut', 'resume_wake_shortcut'],
  ['pause_main_window_mode_shortcut', 'resume_main_window_mode_shortcut'],
  ['pause_registered_app_shortcuts', 'resume_registered_app_shortcuts'],
] as const

export function pauseShortcutRecordingGuards(): void {
  for (const [pauseCommand] of recordingGuardCommands) {
    invoke(pauseCommand).catch(() => {})
  }
}

export function resumeShortcutRecordingGuards(): void {
  for (const [, resumeCommand] of recordingGuardCommands) {
    invoke(resumeCommand).catch(() => {})
  }
}
