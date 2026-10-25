import { messageVisibleText } from './chatMessageDisplay'

// 屏外消息跳过与高度记忆：纯数据规则，不依赖 React/DOM。
// 高度只在本进程内记忆，按「消息身份 + 布局条件 + 内容条件」校验，任一变化即作废。
export const MESSAGE_OFFSCREEN_OVERSCAN_VIEWPORTS = 1
export const MESSAGE_OFFSCREEN_DEFAULT_VIEWPORT_WIDTH = 720
export const MESSAGE_OFFSCREEN_HEIGHT_MEMORY_LIMIT = 4000
export const DEFAULT_MESSAGE_OFFSCREEN_SKIP_ENABLED = true

// 屏外跳过开关：默认开启；关闭后消息始终完整排版绘制，不再使用隐藏与占位。
export function normalizeMessageOffscreenSkipEnabled(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_MESSAGE_OFFSCREEN_SKIP_ENABLED
}

const MIN_ESTIMATED_HEIGHT = 48
const MAX_ESTIMATED_HEIGHT = 2400
const ESTIMATED_LINE_HEIGHT = 24
const ESTIMATED_IMAGE_HEIGHT = 140

export type MessageOffscreenPresentation = {
  editing?: boolean
  editingLength?: number
  userExpanded?: boolean
  toolExpanded?: boolean
}

export type MessageHeightMemoryEntry = {
  layoutKey: string
  contentKey: string
  height: number
}

export class MessageHeightMemory {
  private entries = new Map<string, MessageHeightMemoryEntry>()

  get size() {
    return this.entries.size
  }

  get(mid: string, layoutKey: string, contentKey: string): number | null {
    const entry = this.entries.get(mid)
    if (!entry) return null
    if (entry.layoutKey !== layoutKey || entry.contentKey !== contentKey) return null
    return entry.height
  }

  set(mid: string, layoutKey: string, contentKey: string, height: number): void {
    const id = String(mid || '').trim()
    if (!id || !isFinite(height) || height <= 0) return
    if (this.entries.has(id)) this.entries.delete(id)
    this.entries.set(id, { layoutKey, contentKey, height })
    while (this.entries.size > MESSAGE_OFFSCREEN_HEIGHT_MEMORY_LIMIT) {
      const oldest = this.entries.keys().next().value
      if (!oldest) break
      this.entries.delete(oldest)
    }
  }

  delete(mid: string): void {
    this.entries.delete(String(mid || '').trim())
  }

  clear(): void {
    this.entries.clear()
  }
}

export const messageHeightMemory = new MessageHeightMemory()

export function messageLayoutKey(layoutSignature: string, viewportWidth: number): string {
  const width = Math.max(0, Math.round(Number(viewportWidth) || 0))
  return `${String(layoutSignature || '')}@${width}`
}

function hashText(value: unknown): number {
  const text = String(value ?? '')
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function partSignature(part: any): string {
  if (!part || typeof part !== 'object') return ''
  const result = part.result && typeof part.result === 'object' ? Object.keys(part.result).length : hashText(part.result)
  return [
    String(part.type || ''),
    String(part.state || ''),
    String(part.toolName || part.name || ''),
    String(part.toolCallId || part.callId || ''),
    String(part.text || '').length,
    hashText(part.text),
    result,
  ].join(':')
}

// 内容键只做轻量结构摘要：updatedAt 覆盖流式/编辑更新，文本哈希兜住同时间戳、同长度的内容改动。
export function messageOffscreenContentKey(message: any, presentation?: MessageOffscreenPresentation): string {
  const m = message && typeof message === 'object' ? message : {}
  const parts = Array.isArray(m.parts) ? m.parts : []
  const images = Array.isArray(m.images) ? m.images : []
  const toolImages = Array.isArray(m.toolImages) ? m.toolImages : []
  const control = m.control && typeof m.control === 'object' ? m.control : null
  const content = messageVisibleText(m)
  return [
    String(m.role || ''),
    String(m.type || ''),
    Number(m.updatedAt || 0),
    content.length,
    hashText(content),
    parts.map(partSignature).join(','),
    images.join(','),
    toolImages.join(','),
    String(m.speakerRoleId || ''),
    String(m.modelRef?.modelId || m.modelRef?.name || ''),
    m.error && typeof m.error === 'object' ? 'error' : '',
    control ? `${Number(control.summaryVersion || 0)}:${Number(control.retainRecentMessages || 0)}` : '',
    String(m.assistantRun?.status || ''),
    m.streaming ? 'streaming' : '',
    m.pending ? 'pending' : '',
    m.displayOnlyPendingRunTail ? 'tail' : '',
    presentation?.editing ? `editing:${Number(presentation.editingLength || 0)}` : '',
    presentation?.userExpanded ? 'user-expanded' : '',
    presentation?.toolExpanded ? 'tool-expanded' : '',
  ].join('|')
}

// 未测高度时的占位预估：只用于占位与邻近判定，测出后会立即被实测高度替换。
export function estimateMessageHeight(message: any, viewportWidth: number = MESSAGE_OFFSCREEN_DEFAULT_VIEWPORT_WIDTH): number {
  const width = Number(viewportWidth) > 0 ? Number(viewportWidth) : MESSAGE_OFFSCREEN_DEFAULT_VIEWPORT_WIDTH
  const text = messageVisibleText(message)
  const usableWidth = Math.max(160, width - 120)
  const charsPerLine = Math.max(12, Math.floor(usableWidth / 8.5))
  let lines = 0
  for (const line of text.split(/\r?\n/)) {
    lines += Math.max(1, Math.ceil(line.length / charsPerLine))
  }
  const images = Array.isArray(message?.images) ? message.images.length : 0
  const toolImages = Array.isArray(message?.toolImages) ? message.toolImages.length : 0
  const base = String(message?.role || '') === 'user' ? 40 : 76
  const estimated = base + lines * ESTIMATED_LINE_HEIGHT + (images + toolImages) * ESTIMATED_IMAGE_HEIGHT
  return Math.round(Math.min(MAX_ESTIMATED_HEIGHT, Math.max(MIN_ESTIMATED_HEIGHT, estimated)))
}
