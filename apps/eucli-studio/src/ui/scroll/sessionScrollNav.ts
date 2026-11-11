// 会话消息区的键盘翻页。
// 职责只有两件：把「Ctrl + 翻页键 / 首尾键」翻译成滚动意图，再把意图落到容器上。
// 谁在听键、什么页面才接管，交给页面壳层决定；这里不认识输入框，也不认识会话。

export type SessionScrollIntent = 'page-up' | 'page-down' | 'top' | 'bottom'

// 翻页留一点重叠，和原生 PageUp / PageDown 的手感对齐：
// 一屏取 87.5%，上一屏末尾那几行在下一屏还看得见。
export const SESSION_SCROLL_PAGE_STEP_RATIO = 0.875

type SessionScrollKeyEvent = {
  key?: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}

// 只认 Ctrl：macOS 上 Cmd + Home / End 走的是「文稿首尾」另一套语义，
// 这组键只接管 Windows / Linux 的 Ctrl 组合。
// Shift 必须排除：Ctrl + Shift + Home / End 是在输入框里选到首尾，不能被抢。
export function resolveSessionScrollIntent(e: SessionScrollKeyEvent | null | undefined): SessionScrollIntent | '' {
  if (!e || !e.ctrlKey) return ''
  if (e.altKey || e.shiftKey || e.metaKey) return ''
  switch (e.key) {
    case 'PageUp':
      return 'page-up'
    case 'PageDown':
      return 'page-down'
    case 'Home':
      return 'top'
    case 'End':
      return 'bottom'
    default:
      return ''
  }
}

// 容器得真的还有可滚空间才值得接管这组键。
// 消息不满一屏时不接，免得白吞掉浏览器原本的默认行为。
export function canSessionScroll(el: { scrollHeight: number; clientHeight: number } | null | undefined): boolean {
  if (!el) return false
  return el.scrollHeight - el.clientHeight > 1
}

type SessionScrollSurface = {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
  scrollTo: (options: { top: number; behavior?: ScrollBehavior }) => void
}

// 意图 → 目标位置。上下界在这里夹死，纯算术，不碰 DOM。
export function resolveSessionScrollTop(
  el: Pick<SessionScrollSurface, 'scrollTop' | 'clientHeight' | 'scrollHeight'>,
  intent: SessionScrollIntent,
): number {
  const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)

  if (intent === 'top') return 0
  if (intent === 'bottom') return maxScrollTop

  const step = el.clientHeight * SESSION_SCROLL_PAGE_STEP_RATIO
  const next = intent === 'page-up' ? el.scrollTop - step : el.scrollTop + step
  return Math.min(maxScrollTop, Math.max(0, next))
}

// 落点交给平滑滚动，而不是直接写位置：
// 原生这几个键走的就是滚动动画，直接赋值会变成瞬移，看着像页面被硬拽了一下。
// 交给浏览器同一条滚动动画通道，翻页的「过程感」才和原生一致。
export function applySessionScrollIntent(el: SessionScrollSurface, intent: SessionScrollIntent): void {
  el.scrollTo({ top: resolveSessionScrollTop(el, intent), behavior: 'smooth' })
}
