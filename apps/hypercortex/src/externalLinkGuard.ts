import { invoke } from '@tauri-apps/api/core'

/**
 * 渲染内容外部链接守卫。
 *
 * 目标状态（约束集 094）：渲染内容里的链接点击不产生应用内导航，
 * 外部目标改交系统浏览器打开；锚点与同源地址保持原行为。
 */

const RENDER_ROOT_SELECTOR = '.hc-render'
const GUARD_FLAG = 'data-hc-external-link-guard'

/** 判断链接目标是否应交给系统浏览器（外部 http/https 或 mailto/tel）。 */
export function isExternalHref(href: string, baseHref: string = window.location.href): boolean {
  const raw = String(href ?? '').trim()
  if (!raw || raw.startsWith('#')) return false
  let target: URL
  let base: URL
  try {
    target = new URL(raw, baseHref)
    base = new URL(baseHref)
  } catch {
    return false
  }
  const scheme = target.protocol.toLowerCase()
  if (scheme === 'mailto:' || scheme === 'tel:') return true
  if (scheme !== 'http:' && scheme !== 'https:') return false
  return target.origin !== base.origin
}

function resolveExternalTarget(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute('href') || ''
  if (!isExternalHref(href)) return null
  try {
    return new URL(href, window.location.href).href
  } catch {
    return null
  }
}

function handleClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return
  if (!anchor.closest(RENDER_ROOT_SELECTOR)) return
  const url = resolveExternalTarget(anchor)
  if (!url) return
  event.preventDefault()
  event.stopPropagation()
  invoke('open_external_url', { url }).catch(() => {
    /* 打开失败不阻塞交互 */
  })
}

/** 在文档上注册一次外链守卫（幂等）。 */
export function installExternalLinkGuard(doc: Document = document): void {
  if (doc.documentElement.getAttribute(GUARD_FLAG) === '1') return
  doc.documentElement.setAttribute(GUARD_FLAG, '1')
  doc.addEventListener('click', handleClick, true)
}
