export type RequestPayloadMessage = {
  role: string
  content: string
  reasoning: string
  toolCalls: Array<{ name: string; arguments: string }>
  toolCallId: string
  name: string
}

export type RequestPayloadTool = {
  name: string
  description: string
  parameters: string
}

export type RequestPayloadView = {
  params: Array<{ key: string; value: string }>
  messages: RequestPayloadMessage[]
  tools: RequestPayloadTool[]
}

export type ResponseSegment =
  | { kind: 'reasoning'; text: string }
  | { kind: 'content'; text: string }
  | { kind: 'toolCall'; name: string; arguments: string }
  | { kind: 'finish'; text: string }
  | { kind: 'other'; text: string }

export type ResponseStreamView = {
  segments: ResponseSegment[]
  done: boolean
}

// parseRequestPayloadText 识别 OpenAI 协议请求体结构（含 messages 数组）；
// 识别失败返回 null，由展示层降级为格式化文本。
export function parseRequestPayloadText(text: string): RequestPayloadView | null {
  const value = tryParseJson(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const messagesRaw = (value as any).messages
  if (!Array.isArray(messagesRaw)) return null
  const params: Array<{ key: string; value: string }> = []
  for (const [key, raw] of Object.entries(value as Record<string, any>)) {
    if (key === 'messages' || key === 'tools') continue
    params.push({ key, value: describeParamValue(raw) })
  }
  return {
    params,
    messages: messagesRaw.map(parsePayloadMessage),
    tools: parsePayloadTools((value as any).tools),
  }
}

// parseResponseStreamText 识别 SSE 响应流并合并为回合时间线；
// 识别失败（没有任何事件行）返回 null，由展示层降级为文本。
export function parseResponseStreamText(text: string): ResponseStreamView | null {
  const segments: ResponseSegment[] = []
  const toolCallSegments = new Map<number, number>()
  let done = false
  let recognized = 0

  const pushTextSegment = (kind: 'reasoning' | 'content', delta: string) => {
    if (!delta) return
    const last = segments[segments.length - 1]
    if (last && last.kind === kind) {
      last.text += delta
      return
    }
    segments.push({ kind, text: delta })
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (!line.startsWith('data:')) continue
    const payload = line.slice('data:'.length).trim()
    if (payload === '[DONE]') {
      recognized += 1
      done = true
      continue
    }
    const event = tryParseJson(payload)
    if (!event || typeof event !== 'object') {
      recognized += 1
      segments.push({ kind: 'other', text: payload })
      continue
    }
    recognized += 1
    const choice = Array.isArray((event as any).choices) ? (event as any).choices[0] : null
    const delta = choice && typeof choice === 'object' ? choice.delta : null
    let used = false
    if (delta && typeof delta === 'object') {
      const reasoningDelta = reasoningDeltaText(delta)
      if (reasoningDelta) {
        pushTextSegment('reasoning', reasoningDelta)
        used = true
      }
      if (typeof delta.content === 'string' && delta.content !== '') {
        pushTextSegment('content', delta.content)
        used = true
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const toolCall of delta.tool_calls) {
          const indexRaw = Number(toolCall?.index)
          const index = Number.isFinite(indexRaw) ? indexRaw : 0
          const name = typeof toolCall?.function?.name === 'string' ? toolCall.function.name : ''
          const args = typeof toolCall?.function?.arguments === 'string' ? toolCall.function.arguments : ''
          const existing = toolCallSegments.get(index)
          if (existing === undefined) {
            segments.push({ kind: 'toolCall', name, arguments: args })
            toolCallSegments.set(index, segments.length - 1)
          } else {
            const segment = segments[existing]
            if (segment.kind === 'toolCall') {
              if (name && !segment.name) segment.name = name
              segment.arguments += args
            }
          }
          used = true
        }
      }
    }
    if (choice && typeof choice === 'object' && choice.finish_reason) {
      const reason = String(choice.finish_reason)
      const usage = (event as any).usage
      segments.push({ kind: 'finish', text: usage ? `结束原因：${reason}；用量：${JSON.stringify(usage)}` : `结束原因：${reason}` })
      used = true
    } else if ((event as any).usage && !choice) {
      segments.push({ kind: 'finish', text: `用量：${JSON.stringify((event as any).usage)}` })
      used = true
    }
    if (!used) {
      if (isMeaninglessStreamEvent(event as any, choice, delta)) {
        continue
      }
      segments.push({ kind: 'other', text: payload })
    }
  }

  if (recognized === 0) return null
  return { segments, done }
}

// isMeaninglessStreamEvent 判断无内容的控制事件（角色声明、空 delta 等）：
// 事件 delta 中除 role / logprobs 控制键外没有任何有效内容，且无结束原因与用量时忽略。
function isMeaninglessStreamEvent(event: any, choice: any, delta: any): boolean {
  if (!choice || typeof choice !== 'object') return false
  if (choice.finish_reason) return false
  if (event?.usage) return false
  if (!delta || typeof delta !== 'object') return true
  for (const [key, value] of Object.entries(delta)) {
    if (key === 'role' || key === 'logprobs') continue
    if (typeof value === 'string' && value !== '') return false
    if (Array.isArray(value) && value.length > 0) return false
    if (value && typeof value === 'object') return false
  }
  return true
}

function parsePayloadMessage(raw: any): RequestPayloadMessage {
  return {
    role: typeof raw?.role === 'string' ? raw.role : '',
    content: describeMessageContent(raw?.content),
    reasoning: describeMessageReasoning(raw),
    toolCalls: parseToolCalls(raw?.tool_calls),
    toolCallId: typeof raw?.tool_call_id === 'string' ? raw.tool_call_id : '',
    name: typeof raw?.name === 'string' ? raw.name : '',
  }
}

// describeMessageReasoning 提取消息中的思考原文：优先 reasoning_content，其次 reasoning 字符串。
function describeMessageReasoning(raw: any): string {
  if (typeof raw?.reasoning_content === 'string' && raw.reasoning_content !== '') return raw.reasoning_content
  if (typeof raw?.reasoning === 'string' && raw.reasoning !== '') return raw.reasoning
  return ''
}

// reasoningDeltaText 提取流事件中的思考增量：兼容 reasoning_content、reasoning 字符串、
// reasoning 对象文本与 reasoning_details 文本（同一事件内多来源重复时只取最高优先级来源）。
function reasoningDeltaText(delta: any): string {
  if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content !== '') return delta.reasoning_content
  if (typeof delta?.reasoning === 'string' && delta.reasoning !== '') return delta.reasoning
  const reasoning = delta?.reasoning
  if (reasoning && typeof reasoning === 'object' && typeof reasoning.text === 'string' && reasoning.text !== '') return reasoning.text
  if (Array.isArray(delta?.reasoning_details)) {
    for (const detail of delta.reasoning_details) {
      if (typeof detail?.text === 'string' && detail.text !== '') return detail.text
    }
  }
  return ''
}

function describeMessageContent(content: any): string {
  if (typeof content === 'string') return content
  if (content === null || content === undefined) return ''
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const item of content) {
      if (typeof item === 'string') {
        parts.push(item)
        continue
      }
      const type = typeof item?.type === 'string' ? item.type : ''
      if (type === 'text' && typeof item?.text === 'string') {
        parts.push(item.text)
        continue
      }
      if (type === 'image_url' || type === 'input_image' || type === 'image') {
        parts.push('[图片]')
        continue
      }
      parts.push(JSON.stringify(item))
    }
    return parts.join('\n')
  }
  if (typeof content === 'object') return JSON.stringify(content)
  return String(content)
}

function parseToolCalls(raw: any): Array<{ name: string; arguments: string }> {
  if (!Array.isArray(raw)) return []
  return raw.map((toolCall: any) => ({
    name: typeof toolCall?.function?.name === 'string' ? toolCall.function.name : '',
    arguments: typeof toolCall?.function?.arguments === 'string' ? toolCall.function.arguments : '',
  }))
}

function parsePayloadTools(raw: any): RequestPayloadTool[] {
  if (!Array.isArray(raw)) return []
  return raw.map((tool: any) => {
    const definition = tool?.function && typeof tool.function === 'object' ? tool.function : tool
    const parameters = definition?.parameters ?? null
    return {
      name: typeof definition?.name === 'string' ? definition.name : '',
      description: typeof definition?.description === 'string' ? definition.description : '',
      parameters: parameters === null ? '' : JSON.stringify(parameters, null, 2),
    }
  })
}

function describeParamValue(value: any): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function tryParseJson(text: string): any | null {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}
