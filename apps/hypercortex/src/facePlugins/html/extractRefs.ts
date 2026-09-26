import { extractRefsFromText, type NoteRef } from '../../noteRefs'

/**
 * 网页面引用提取：遮蔽 HTML 代码/注释区域（script/style/pre/code/注释），再按统一占位符语法解析。
 * 遮蔽算法与后端 html 插件包保持一致。
 */

const HTML_MASK_PATTERNS = [
  /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
  /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
  /<pre\b[^>]*>[\s\S]*?<\/pre\s*>/gi,
  /<code\b[^>]*>[\s\S]*?<\/code\s*>/gi,
  /<!--[\s\S]*?-->/g,
]

function maskHtmlCode(body: string): string {
  const src = String(body || '')
  const chars = src.split('')
  for (const pattern of HTML_MASK_PATTERNS) {
    for (const match of src.matchAll(pattern)) {
      const start = Number(match.index ?? 0)
      const end = start + String(match[0] || '').length
      for (let i = start; i < end; i++) chars[i] = ' '
    }
  }
  return chars.join('')
}

export function extractHtmlFaceRefs(content: string): NoteRef[] {
  return extractRefsFromText(maskHtmlCode(content))
}
