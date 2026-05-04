import { esc } from '../core/utils'
import type { BoolRef } from './types'
import { tokenizeFences } from './preprocess'

export function preprocessHtmlIndentation(source: unknown) {
  function dedentHtmlLines(s: unknown) {
    const t = String(s || '')
    // Markdown：4 空格缩进会被当作代码块；HTML 内部常见缩进会触发这个坑。
    // 仅在“非代码围栏”区域，把以 4 空格/Tab 开头且后面紧跟 < 或 <!-- 的行去掉缩进。
    // 注意：有些模型会输出“空格+Tab”的混合缩进；Markdown 的缩进宽度是按列计算的（Tab 会补到 4 的倍数）。
    // 这里把这类行的前导缩进压到 <4 列（保留 0~3 个空格），避免被 marked 识别成缩进代码块。
    return t.replace(/^([ \t]+)(?=<|<!--)/gm, (_m, ws) => {
      const w = String(ws || '')
      let cols = 0
      for (let i = 0; i < w.length; i++) {
        cols += w[i] === '\t' ? 4 - (cols % 4) : 1
      }
      if (cols < 4) return w
      return ' '.repeat(cols % 4)
    })
  }

  const src = String(source || '').replace(/\r\n/g, '\n')
  const tokens = tokenizeFences(src)
  return tokens
    .map((t) => {
      if (t.kind === 'text') return dedentHtmlLines(t.text)
      return t.raw
    })
    .join('')
}

export function createMarkdownRenderer(markedConfigured: BoolRef) {
  function renderMarkdownSource(source: unknown) {
    const src = String(source || '')

    const w = window as any
    if (!w.marked || typeof w.marked.parse !== 'function') {
      return `<pre>${esc(src)}</pre>`
    }

    try {
      if (!markedConfigured.value) {
        markedConfigured.value = true
        w.marked.setOptions?.({ gfm: true, breaks: true })
      }
      // 唯一渲染机制：始终走 Markdown（marked 会保留 HTML block，同时解析后续 Markdown）
      return w.marked.parse(src)
    } catch (_) {
      return `<pre>${esc(src)}</pre>`
    }
  }

  return { renderMarkdownSource }
}

