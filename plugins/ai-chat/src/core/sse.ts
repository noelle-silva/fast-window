export function extractOpenAiDelta(json: any) {
  return (
    json?.choices?.[0]?.delta?.content ??
    json?.choices?.[0]?.delta?.text ??
    json?.choices?.[0]?.text ??
    json?.output_text ??
    ''
  )
}

export function sseFeed(state: any, chunkText: any, onJson: ((json: any) => void) | null) {
  if (!state || typeof state !== 'object') return false
  const add = String(chunkText || '')
  if (!add) return !!state.done

  state.buf = String(state.buf || '') + add
  if (state.buf.indexOf('\r') >= 0) state.buf = state.buf.replace(/\r/g, '')

  while (true) {
    const idx = state.buf.indexOf('\n\n')
    if (idx < 0) break
    const block = state.buf.slice(0, idx)
    state.buf = state.buf.slice(idx + 2)

    const lines = block.split('\n')
    const datas: string[] = []
    for (const line of lines) {
      if (!line || line[0] === ':') continue
      if (line.startsWith('data:')) datas.push(line.slice(5).replace(/^\s+/, ''))
    }
    const data = datas.join('\n').trim()
    if (!data) continue
    if (data === '[DONE]') {
      state.done = true
      break
    }

    let json = null
    try {
      json = JSON.parse(data)
    } catch (_) {
      continue
    }

    // 先处理本块 JSON（可能包含最后一段 delta），再根据 finish_reason 判定是否结束。
    onJson && onJson(json)

    // OpenAI 兼容实现常见差异：不发送 [DONE]，而是在最后一块 JSON 中携带 finish_reason。
    // 若只等 [DONE] 或连接 close，会出现“内容已完整但 pending 一直不结束”。
    const fr =
      json?.choices?.[0]?.finish_reason ??
      json?.choices?.[0]?.finishReason ??
      json?.finish_reason ??
      json?.finishReason ??
      null
    if (fr != null && String(fr).trim()) {
      state.done = true
      ;(state as any).finishReason = String(fr)
      break
    }
  }

  return !!state.done
}

