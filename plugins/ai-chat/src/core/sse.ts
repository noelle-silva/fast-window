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
    onJson && onJson(json)
  }

  return !!state.done
}

