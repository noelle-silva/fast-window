import { uid } from '../core/utils'

export const HOOK_PROMPT_SESSION_METADATA_KEY = 'hookPrompt.presetId'
export const HOOK_PROMPT_SESSION_METADATA_MODE_KEY = 'hookPrompt.mode'

export const HOOK_PROMPT_POSITIONS = [
  'session_top',
  'before_user',
  'after_user',
  'before_latest',
  'after_latest',
  'inside_user_top',
  'inside_user_bottom',
] as const

export type HookPromptPosition = (typeof HOOK_PROMPT_POSITIONS)[number]
export type HookPromptRole = 'system' | 'user' | 'assistant'
export type HookPromptSelectionMode = 'inherit' | 'none' | 'preset'

export type HookPromptMessage = {
  id: string
  role: HookPromptRole
  position: HookPromptPosition
  content: string
  order: number
  createdAt?: string
  updatedAt?: string
}

export type HookPromptPreset = {
  id: string
  name: string
  messages: HookPromptMessage[]
  createdAt?: string
  updatedAt?: string
}

export type HookPromptLibrary = {
  presets: HookPromptPreset[]
}

export const HOOK_PROMPT_POSITION_LABELS: Record<HookPromptPosition, string> = {
  session_top: '对话最开头',
  before_user: '用户最新消息前',
  after_user: '用户最新消息后',
  before_latest: '会话最新消息前',
  after_latest: '会话最新消息后',
  inside_user_top: '用户消息内部开头',
  inside_user_bottom: '用户消息内部末尾',
}

export const HOOK_PROMPT_ROLE_LABELS: Record<HookPromptRole, string> = {
  system: '系统',
  user: '用户',
  assistant: 'AI',
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeHookPromptRole(value: unknown): HookPromptRole {
  const role = text(value)
  if (role === 'system' || role === 'assistant') return role
  return 'user'
}

export function normalizeHookPromptSelectionMode(value: unknown): HookPromptSelectionMode {
  const mode = text(value)
  if (mode === 'none' || mode === 'preset') return mode
  return 'inherit'
}

export function hookPromptRoleForPosition(position: HookPromptPosition, roleRaw: unknown): HookPromptRole {
  if (position === 'inside_user_top' || position === 'inside_user_bottom') return 'user'
  return normalizeHookPromptRole(roleRaw)
}

export function isHookPromptPosition(value: unknown): value is HookPromptPosition {
  return (HOOK_PROMPT_POSITIONS as readonly string[]).includes(text(value))
}

export function normalizeHookPromptLibrary(raw: unknown): HookPromptLibrary {
  const box = raw && typeof raw === 'object' ? (raw as any) : {}
  const presetsRaw = Array.isArray(box.presets) ? box.presets : []
  const presets: HookPromptPreset[] = []
  const seenPresetIds = new Set<string>()
  for (const presetRaw of presetsRaw) {
    const presetBox = presetRaw && typeof presetRaw === 'object' ? presetRaw as any : {}
    const id = text(presetBox.id)
    const name = text(presetBox.name)
    if (!id || !name || seenPresetIds.has(id)) continue
    seenPresetIds.add(id)
    const messages = normalizeHookPromptMessages(presetBox.messages)
    presets.push({ id, name, messages, createdAt: text(presetBox.createdAt), updatedAt: text(presetBox.updatedAt) })
  }
  return { presets }
}

export function normalizeHookPromptMessages(raw: unknown): HookPromptMessage[] {
  const messagesRaw = Array.isArray(raw) ? raw : []
  const messages: HookPromptMessage[] = []
  const seenMessageIds = new Set<string>()
  for (const messageRaw of messagesRaw) {
    const messageBox = messageRaw && typeof messageRaw === 'object' ? messageRaw as any : {}
    const id = text(messageBox.id)
    const position = text(messageBox.position)
    const content = text(messageBox.content)
    if (!id || !content || !isHookPromptPosition(position) || seenMessageIds.has(id)) continue
    seenMessageIds.add(id)
    messages.push({
      id,
      role: hookPromptRoleForPosition(position, messageBox.role),
      position,
      content,
      order: Math.max(0, Math.floor(Number(messageBox.order || 0))),
      createdAt: text(messageBox.createdAt),
      updatedAt: text(messageBox.updatedAt),
    })
  }
  messages.sort((left, right) => {
    const leftPosition = HOOK_PROMPT_POSITIONS.indexOf(left.position)
    const rightPosition = HOOK_PROMPT_POSITIONS.indexOf(right.position)
    if (leftPosition !== rightPosition) return leftPosition - rightPosition
    if (left.order !== right.order) return left.order - right.order
    return left.id.localeCompare(right.id)
  })
  return reindexHookPromptMessages(messages)
}

export function reindexHookPromptMessages(messages: HookPromptMessage[]) {
  return messages.map((message, order) => ({ ...message, order }))
}

export function createHookPromptPreset(): HookPromptPreset {
  const ts = new Date().toISOString()
  return { id: uid('hook-preset'), name: '新预设', messages: [], createdAt: ts, updatedAt: ts }
}

export function createHookPromptMessage(position: HookPromptPosition): HookPromptMessage {
  const ts = new Date().toISOString()
  return { id: uid('hook-msg'), role: hookPromptRoleForPosition(position, 'user'), position, content: '', order: 0, createdAt: ts, updatedAt: ts }
}

export function hookPromptPresetName(library: HookPromptLibrary, presetIdRaw: unknown) {
  const presetId = text(presetIdRaw)
  if (!presetId) return '无预设'
  return library.presets.find((preset) => preset.id === presetId)?.name || '预设已缺失'
}

export function normalizeHookPromptSelection(raw: unknown): { mode: HookPromptSelectionMode; presetId: string } {
  const box = raw && typeof raw === 'object' ? raw as any : {}
  const mode = normalizeHookPromptSelectionMode(box.hookPromptMode ?? box.mode)
  const presetId = text(box.hookPromptPresetId ?? box.presetId)
  if (mode === 'preset' && !presetId) return { mode: 'inherit', presetId: '' }
  if (mode === 'inherit') return { mode: 'inherit', presetId: '' }
  if (mode === 'none') return { mode: 'none', presetId: '' }
  return presetId ? { mode: 'preset', presetId } : { mode: 'inherit', presetId: '' }
}

export function hookPromptSelectionLabel(library: HookPromptLibrary, modeRaw: unknown, presetIdRaw: unknown, roleDefaultPresetIdRaw?: unknown) {
  const mode = normalizeHookPromptSelectionMode(modeRaw)
  const presetId = text(presetIdRaw)
  const roleDefaultPresetId = text(roleDefaultPresetIdRaw)
  if (mode === 'none') return '无预设'
  if (mode === 'preset') return hookPromptPresetName(library, presetId)
  if (roleDefaultPresetId) return `跟随角色：${hookPromptPresetName(library, roleDefaultPresetId)}`
  return '跟随角色'
}
