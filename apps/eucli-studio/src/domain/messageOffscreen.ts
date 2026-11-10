import { messageVisibleText } from './chatMessageDisplay'

// 屏外消息跳过与高度记忆：纯数据规则，不依赖 React/DOM。
// 高度只在本进程内记忆，按「消息身份 + 布局条件 + 内容条件」校验，任一变化即作废。
// 「内容条件」（contentKey）只服务占位高度的失效判断，是结构摘要，取舍见 messageOffscreenContentKey。
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

// 只读长度，绝不遍历内容本身：String(x) 对字符串是恒等、对其它类型是常量级转换。
function textLength(value: unknown): number {
  return String(value || '').length
}

// part 结构摘要：固定字段顺序、固定分隔符 ':'，只读结构与长度，不读正文。
// 顺序：type : state : toolName|name : toolCallId|callId|id : 正文长度 : result 摘要 : runtimeOutput 摘要。
function partSignature(part: any): string {
  if (!part || typeof part !== 'object') return ''
  const result = part.result && typeof part.result === 'object' ? part.result : null
  const runtime = part.runtimeOutput && typeof part.runtimeOutput === 'object' ? part.runtimeOutput : null
  return [
    String(part.type || ''),
    String(part.state || ''),
    String(part.toolName || part.name || ''),
    String(part.toolCallId || part.callId || part.id || ''),
    textLength(part.text),
    result ? `r:${String(result.status || '')}:${textLength(result.content || result.error)}` : '',
    runtime ? `o:${Number(runtime.bytes || 0)}:${textLength(runtime.preview)}` : '',
  ].join(':')
}

// 内容键：屏外占位高度记忆的「内容条件」指纹，每次列表渲染对每条已上屏消息都会求值，
// 所以它必须是 O(1) + O(parts) 的结构摘要 —— 只读长度与结构字段，绝不对正文做哈希/扫描。
//
// 取舍：它刻意不具备「同 updatedAt、同长度的内容改动」识别能力，因为它只服务屏外占位高度的失效。
// 判错一次的全部代价是占位高度差一行，消息可见后会立刻被实测高度修正，不产生可见错误；
// 而消息的任何一次写入都会推进 updatedAt，真实编辑必然被 updatedAt 字段捕获。
//
// 字段顺序（分隔符 '|'）：
// role / type / updatedAt / 正文长度 / parts 摘要 / images / toolImages / speakerRoleId /
// 模型标识 / 错误标记 / control 摘要 / assistantRun.status / streaming / pending /
// displayOnlyPendingRunTail / editing / userExpanded / toolExpanded。
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
