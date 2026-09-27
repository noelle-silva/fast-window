const RECORD_JSON_INDENT = 2

// formatJsonText 把整体可解析为 JSON 对象或数组的文本展开为缩进格式；
// 非 JSON 或解析失败时返回 null，由调用方保持原文显示。
export function formatJsonText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const first = trimmed[0]
  if (first !== '{' && first !== '[') return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, RECORD_JSON_INDENT)
  } catch {
    return null
  }
}
