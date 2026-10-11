import { parseNotePlaceholderBody } from '../../notePlaceholder'

const REF_PATTERN = /\[\[[^\]\n]+?\]\]/g

/** 节点文本是否含系统引用占位符。 */
export function nodeTextHasRef(text: string): boolean {
  return /\[\[[^\]\n]+?\]\]/.test(String(text || ''))
}

/**
 * 为含引用的节点构建自定义内容（HTML）：节点文本里的引用渲染为可点击链接。
 * 无引用时返回 null，交由导图库使用内置文本渲染。
 */
export function buildMindmapNodeContent(text: string, resolveTitle: (noteId: string) => string): HTMLElement | null {
  const source = String(text || '')
  if (!nodeTextHasRef(source)) return null
  const container = document.createElement('div')
  container.style.whiteSpace = 'pre-wrap'
  let lastIndex = 0
  for (const match of source.matchAll(REF_PATTERN)) {
    const start = match.index ?? 0
    if (start > lastIndex) container.appendChild(document.createTextNode(source.slice(lastIndex, start)))
    const parsed = parseNotePlaceholderBody(match[0].slice(2, -2))
    const noteId = String(parsed?.noteId || '').trim()
    if (noteId) {
      const anchor = document.createElement('a')
      anchor.setAttribute('data-mindmap-ref-note', noteId)
      const faceId = String(parsed?.face || '').trim()
      if (faceId) anchor.setAttribute('data-mindmap-ref-face', faceId)
      anchor.textContent = resolveTitle(noteId) || noteId
      anchor.style.color = '#4f46e5'
      anchor.style.textDecoration = 'underline'
      anchor.style.cursor = 'pointer'
      container.appendChild(anchor)
    } else {
      container.appendChild(document.createTextNode(match[0]))
    }
    lastIndex = start + match[0].length
  }
  if (lastIndex < source.length) container.appendChild(document.createTextNode(source.slice(lastIndex)))
  return container
}
