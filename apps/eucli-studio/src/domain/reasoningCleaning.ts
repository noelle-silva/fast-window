// 思维链清洗：从会话 / 单条消息的思维链里删除命中的关键词。
// 约束：只动思维链（reasoning 部件）的文本；正文、工具调用与其他内容一律不碰。

// parseReasoningCleanKeywords 把用户输入（一行一个关键词）解析成去重、去空后的关键词列表。
export function parseReasoningCleanKeywords(input: unknown): string[] {
  const raw = String(input ?? '')
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of raw.split(/\r?\n/)) {
    const keyword = line.trim()
    if (!keyword || seen.has(keyword)) continue
    seen.add(keyword)
    out.push(keyword)
  }
  return out
}

// removeReasoningKeywords 从一段思维链文本里删除所有命中的关键词。
// 用 split/join 做字面量删除，关键词里的正则符号不会被当成模式。
export function removeReasoningKeywords(text: unknown, keywords: readonly string[]): string {
  let out = String(text ?? '')
  for (const keyword of keywords) {
    if (!keyword) continue
    out = out.split(keyword).join('')
  }
  return out
}

function reasoningPartType(part: any) {
  return String(part?.type || '').trim() === 'reasoning'
}

// cleanMessageReasoningParts 清洗单条消息的思维链，返回是否发生改动。
export function cleanMessageReasoningParts(message: any, keywords: readonly string[]): boolean {
  if (!message || typeof message !== 'object') return false
  const parts = Array.isArray(message.parts) ? message.parts : []
  let changed = false
  for (const part of parts) {
    if (!reasoningPartType(part)) continue
    const text = String(part.text ?? '')
    const next = removeReasoningKeywords(text, keywords)
    if (next !== text) {
      part.text = next
      changed = true
    }
  }
  return changed
}
