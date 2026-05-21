export const CLIPBOARD_HISTORY_COMMANDS = {
  folders: 'folders',
} as const

export type ClipboardHistoryCommand = typeof CLIPBOARD_HISTORY_COMMANDS[keyof typeof CLIPBOARD_HISTORY_COMMANDS]

const CLIPBOARD_HISTORY_COMMAND_SET: ReadonlySet<string> = new Set(Object.values(CLIPBOARD_HISTORY_COMMANDS))

export function isClipboardHistoryCommand(command: string): command is ClipboardHistoryCommand {
  return CLIPBOARD_HISTORY_COMMAND_SET.has(command)
}

export function normalizeClipboardHistoryCommand(raw: unknown): ClipboardHistoryCommand | null {
  const command = String(raw || '').trim()
  return isClipboardHistoryCommand(command) ? command : null
}
