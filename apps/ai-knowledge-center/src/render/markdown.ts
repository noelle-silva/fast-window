import { esc } from './utils'
import type { BoolRef } from './types'
import { tokenizeFences } from './preprocess'

export function preprocessHtmlIndentation(source: unknown) {
  function dedentHtmlLines(s: unknown) {
    const text = String(s || '')
    return text.replace(/^([ \t]+)(?=<|<!--)/gm, (_match, whitespace) => {
      const raw = String(whitespace || '')
      let columns = 0
      for (let index = 0; index < raw.length; index++) {
        columns += raw[index] === '\t' ? 4 - (columns % 4) : 1
      }
      if (columns < 4) return raw
      return ' '.repeat(columns % 4)
    })
  }

  const src = String(source || '').replace(/\r\n/g, '\n')
  return tokenizeFences(src)
    .map(token => (token.kind === 'text' ? dedentHtmlLines(token.text) : token.raw))
    .join('')
}

export function createMarkdownRenderer(markedConfigured: BoolRef) {
  function renderMarkdownSource(source: unknown) {
    const src = String(source || '')
    const marked = (window as any).marked
    if (!marked || typeof marked.parse !== 'function') return `<pre>${esc(src)}</pre>`

    if (!markedConfigured.value) {
      markedConfigured.value = true
      marked.setOptions?.({ gfm: true, breaks: true })
    }
    return marked.parse(src)
  }

  return { renderMarkdownSource }
}
