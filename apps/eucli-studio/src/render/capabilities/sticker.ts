import { esc } from '../../core/utils'
import { parseStickerSize, hydrateStickerSizes } from '../stickers'
import { REF_IMG_PLACEHOLDER } from '../refImages'
import type { RenderCapability, RenderContext, ClaimSink } from '../contract'

type StickerClaim = { raw: string; category: string; name: string; size?: number }

// 贴纸能力：认领 [[sticker:分类/名称(:尺寸)]] 令牌，产出贴纸图片，并按尺寸装饰。
// 仅在贴纸开关开启时认领；路径不合法时保持原文（失败隔离）。
export function createStickerCapability(): RenderCapability {
  return {
    id: 'sticker',
    claimText(text: string, ctx: RenderContext, claim: ClaimSink): string {
      if (!ctx.stickersEnabled) return text
      const s = String(text || '')
      if (!s) return s

      const re = /\[\[\s*(?:sticker|表情包)\s*:\s*([^\]\n]{1,220}?)\s*\]\]/g
      return s.replace(re, (m, innerRaw) => {
        const inner = String(innerRaw || '').trim()
        if (!inner) return m

        const p = inner.replace(/\\/g, '/')
        if (!p || p.includes('..') || p.includes('://') || p.includes('\u0000')) return m

        const parts = p
          .split('/')
          .map((x) => String(x || '').trim())
          .filter((x) => !!x)
        if (parts.length !== 2 && parts.length !== 3) return m

        const category = parts[0]
        const name = parts[1]
        if (!category || !name) return m
        if (category.includes(']') || name.includes(']')) return m

        let size: number | undefined = undefined
        if (parts.length === 3) {
          const n = parseStickerSize(parts[2])
          if (!n) return m
          size = n
        }

        return claim.push({ raw: m, category, name, size })
      })
    },
    placeholder(data: unknown, ctx: RenderContext): string {
      const it = data as StickerClaim
      const rawToken = String(it.raw || '')
      const category = String(it.category || '')
      const name = String(it.name || '')
      const size = typeof it.size === 'number' && Number.isFinite(it.size) ? Math.round(it.size) : 0
      const label = category && name ? `${category}/${name}` : rawToken
      const relPath = ctx.getStickerPath ? String(ctx.getStickerPath(category, name) || '').trim() : ''
      if (!relPath) return `<span class="fw-sticker-miss">${esc(rawToken)}</span>`
      const sizeAttr = size > 0 ? ` data-fw-sticker-size="${String(size)}"` : ''
      return `<img class="fw-sticker" data-fw-img="1" data-ref-img="${esc(relPath)}"${sizeAttr} src="${REF_IMG_PLACEHOLDER}" alt="${esc(name || 'sticker')}" title="${esc(label)}" />`
    },
    decorate(fragment) {
      hydrateStickerSizes(fragment)
    },
  }
}
