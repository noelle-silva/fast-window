// 公式渲染备忘录：以（展示模式 + TeX）为键缓存 KaTeX 产出的 HTML。
// 流式输出时整条消息会被反复全量重渲染，若无复用，已渲染过的公式每次都要重新解析。
// 缓存命中时直接贴回既有 HTML，只有新出现的公式才真正执行 KaTeX 解析。
const MATH_HTML_CACHE_LIMIT = 500

function readKatex() {
  const katex = (window as any).katex
  return katex && typeof katex.renderToString === 'function' ? katex : null
}

function cacheKey(displayMode: boolean, tex: string) {
  return `${displayMode ? 'block' : 'inline'}\n${tex}`
}

export function createMathRenderer() {
  const htmlCache = new Map<string, string>()

  function renderMathInto(host: HTMLElement, tex: string, displayMode: boolean) {
    const key = cacheKey(displayMode, tex)
    const cached = htmlCache.get(key)
    if (typeof cached === 'string') {
      host.innerHTML = cached
      return
    }

    const katex = readKatex()
    if (!katex) return
    try {
      const html = katex.renderToString(tex, { displayMode, throwOnError: false })
      if (htmlCache.size >= MATH_HTML_CACHE_LIMIT) {
        const first = htmlCache.keys().next().value
        if (typeof first === 'string') htmlCache.delete(first)
      }
      htmlCache.set(key, html)
      host.innerHTML = html
    } catch (_) {}
  }

  return { renderMathInto }
}
