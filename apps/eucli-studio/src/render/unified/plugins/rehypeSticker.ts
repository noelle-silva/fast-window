import { visit } from 'unist-util-visit'
import { parseStickerSize } from '../../stickers'
import { REF_IMG_PLACEHOLDER } from '../../refImages'

// 表情包插件（rehype 层）：在 HTML 树的文本节点里认领 [[sticker:分类/名称(/尺寸)]]。
//
// 为什么放在 rehype 层：rehype-raw 已把 HTML 块重新解析成真节点，
// 所以块内、嵌套里的文本同样会被遍历到。放在 remark 层则看不到块内内容。
//
// 产出结构与旧引擎保持 1:1，使现有的 decorate / 加载逻辑可以原样复用。

export type StickerPluginCtx = {
  stickersEnabled: boolean
  getStickerPath: ((category: string, name: string) => string) | null
}

const TOKEN = /\[\[\s*(?:sticker|表情包)\s*:\s*([^\]\n]{1,220}?)\s*\]\]/g

type ParsedToken = { category: string; name: string; size: number }

// 与旧版 capabilities/sticker.ts 的解析语义完全一致。
function parseToken(innerRaw: string): ParsedToken | null {
  const inner = String(innerRaw || '').trim()
  if (!inner) return null

  const p = inner.replace(/\\/g, '/')
  if (!p || p.includes('..') || p.includes('://') || p.includes('\u0000')) return null

  const parts = p
    .split('/')
    .map((x) => String(x || '').trim())
    .filter((x) => !!x)
  if (parts.length !== 2 && parts.length !== 3) return null

  const category = parts[0]
  const name = parts[1]
  if (!category || !name) return null
  if (category.includes(']') || name.includes(']')) return null

  let size = 0
  if (parts.length === 3) {
    const n = parseStickerSize(parts[2])
    if (!n) return null
    size = n
  }

  return { category, name, size }
}

function isInsideCode(parent: any): boolean {
  return parent?.type === 'element' && (parent.tagName === 'code' || parent.tagName === 'pre')
}

export function rehypeSticker(options: { getCtx: () => StickerPluginCtx }) {
  return (tree: any) => {
    const ctx = options.getCtx()
    if (!ctx.stickersEnabled) return

    visit(tree, 'text', (node: any, index: any, parent: any) => {
      if (!parent || typeof index !== 'number') return
      if (isInsideCode(parent)) return

      const value = String(node.value || '')
      if (!value.includes('[[')) return

      TOKEN.lastIndex = 0
      const out: any[] = []
      let last = 0
      let m: RegExpExecArray | null = null

      while ((m = TOKEN.exec(value))) {
        const parsed = parseToken(m[1])
        if (!parsed) continue

        if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })

        const relPath = ctx.getStickerPath
          ? String(ctx.getStickerPath(parsed.category, parsed.name) || '').trim()
          : ''

        if (!relPath) {
          out.push({
            type: 'element',
            tagName: 'span',
            properties: { className: ['fw-sticker-miss'] },
            children: [{ type: 'text', value: m[0] }],
          })
        } else {
          const properties: Record<string, unknown> = {
            className: ['fw-sticker'],
            'data-fw-img': '1',
            'data-ref-img': relPath,
            src: REF_IMG_PLACEHOLDER,
            alt: parsed.name,
            title: `${parsed.category}/${parsed.name}`,
          }
          if (parsed.size > 0) properties['data-fw-sticker-size'] = String(parsed.size)
          out.push({ type: 'element', tagName: 'img', properties, children: [] })
        }

        last = m.index + m[0].length
      }

      if (!out.length) return
      if (last < value.length) out.push({ type: 'text', value: value.slice(last) })

      parent.children.splice(index, 1, ...out)
      return index + out.length
    })
  }
}
