import { chatMessageMaterialKind, isAsyncToolResultMessage } from './message'

// 找出消息里每一段「工具调用过程」：从第一条带工具部件的助手消息，
// 到这段过程最后一条消息（无工具的助手消息、或用户/系统消息之前）。
// 工具返回消息属于过程内部，不打断区间。

export type ToolProcessRange = { start: number; end: number; rounds: number; toolCalls: number }

const TOOL_RESPONSE_PREFIX = '<<<[TOOL_RESPONSE]>>>'

function hasToolParts(message: any) {
  const parts = Array.isArray(message?.parts) ? message.parts : []
  return chatMessageMaterialKind(message) === 'assistant'
    && parts.some((part: any) => String(part?.type || '').trim() === 'tool')
}

function isToolResponse(message: any) {
  return isAsyncToolResultMessage(message) || String(message?.content || '').startsWith(TOOL_RESPONSE_PREFIX)
}

// 轮 = 一次模型请求，对应区间内一条带工具的助手消息；调用次数按工具部件计。
function summarizeRange(messages: any[], start: number, end: number) {
  let rounds = 0
  let toolCalls = 0
  for (let index = start; index <= end; index++) {
    const message = messages[index]
    if (chatMessageMaterialKind(message) !== 'assistant') continue
    const parts = Array.isArray(message?.parts) ? message.parts : []
    const tools = parts.filter((part: any) => String(part?.type || '').trim() === 'tool')
    if (!tools.length) continue
    rounds++
    toolCalls += tools.length
  }
  return { rounds, toolCalls }
}

export function findToolProcessRanges(messagesRaw: unknown): ToolProcessRange[] {
  const messages = Array.isArray(messagesRaw) ? messagesRaw : []
  const ranges: ToolProcessRange[] = []
  let start = -1

  messages.forEach((message: any, index) => {
    if (start < 0) {
      if (hasToolParts(message)) start = index
      return
    }
    const assistant = chatMessageMaterialKind(message) === 'assistant'
    if ((assistant && !hasToolParts(message)) || (!assistant && !isToolResponse(message))) {
      ranges.push({ start, end: index - 1, ...summarizeRange(messages, start, index - 1) })
      start = -1
    }
  })

  if (start >= 0) {
    const end = messages.length - 1
    ranges.push({ start, end, ...summarizeRange(messages, start, end) })
  }
  return ranges
}
