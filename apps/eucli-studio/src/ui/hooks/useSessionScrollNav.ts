import * as React from 'react'
import { useEvent } from './useEvent'
import {
  canSessionScroll,
  resolveSessionScrollIntent,
  type SessionScrollIntent,
} from '../scroll/sessionScrollNav'

// 会话消息区的键盘翻页接线。
// 在窗口捕获阶段听键：命中就先 preventDefault，把这个键从「当前焦点元素的默认消费者」
// 手里拿走，再统一滚当前可见的那一页消息。光标停在输入框里时，输入框本来会自己吃掉
// PageUp / PageDown（滚框内），也会把 End 当光标移动；在这里拦下来，行为就统一了。
export function useSessionScrollNav(deps: {
  /** 只有当前是可见的会话页时才接管，切页动画与其它页面不参与。 */
  enabled: boolean
  /** 当前可见会话页的滚动节点；由页面壳层给，切换会话后自动指向新的那一页。 */
  scrollRef: React.RefObject<HTMLElement | null>
  /** 命中后怎么落。调用方在这里顺带校正「要不要继续追新消息」。 */
  onIntent: (intent: SessionScrollIntent, el: HTMLElement) => void
}) {
  const { enabled, scrollRef, onIntent } = deps
  const handleIntent = useEvent(onIntent)

  React.useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      // 别的处理者已经处理过的、输入法组合中的，都不碰。
      if (e.defaultPrevented) return
      if ((e as any).isComposing) return

      const intent = resolveSessionScrollIntent(e)
      if (!intent) return

      const el = scrollRef.current
      if (!el || !canSessionScroll(el)) return

      e.preventDefault()
      handleIntent(intent, el)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled, scrollRef, handleIntent])
}
