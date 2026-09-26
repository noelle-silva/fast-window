import { extractRefsFromText, type NoteRef } from '../../noteRefs'

/**
 * 文字面引用提取：遮蔽 markdown 代码区域（围栏与行内反引号），再按统一占位符语法解析。
 * 遮蔽算法与后端 markdown 插件包保持一致。
 */
export function extractMarkdownFaceRefs(content: string): NoteRef[] {
  return extractRefsFromText(maskCode(content))
}

function maskFencedCodeBlocks(body: string): string {
  const src = String(body || '')
  const chars = src.split('')
  const openRe = /(^|\n)[ \t]{0,3}```/g

  while (true) {
    const m = openRe.exec(src)
    if (!m) break

    const openAt = m.index + m[1].length
    const closeRe = /(^|\n)[ \t]{0,3}```/g
    closeRe.lastIndex = openAt + 3
    const close = closeRe.exec(src)

    let end = src.length
    if (close) {
      const closeAt = close.index + close[1].length
      const lineEnd = src.indexOf('\n', closeAt + 3)
      end = lineEnd >= 0 ? lineEnd + 1 : src.length
    }

    for (let i = openAt; i < end; i++) chars[i] = ' '
    openRe.lastIndex = end
  }

  return chars.join('')
}

function maskInlineCodeSpans(body: string): string {
  const src = String(body || '')
  const chars = src.split('')

  let i = 0
  while (i < src.length) {
    if (src[i] !== '`') {
      i++
      continue
    }
    let j = i
    while (j < src.length && src[j] === '`') j++
    const fence = src.slice(i, j)
    const closeAt = src.indexOf(fence, j)
    if (closeAt < 0) {
      i = j
      continue
    }
    const end = closeAt + fence.length
    for (let p = i; p < end; p++) chars[p] = ' '
    i = end
  }

  return chars.join('')
}

function maskCode(body: string): string {
  return maskInlineCodeSpans(maskFencedCodeBlocks(body))
}
