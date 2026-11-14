import * as React from 'react'
import { useStickFollow } from './useStickFollow'

// 自滚区域的跟底：内容还在增长时，只要视口还归我们管就继续贴住；
// 用户真的把视口往上带走才交还控制权，滚回底部再恢复跟随。
//
// 判定与写入的通用部分在 useStickFollow；这一层只补自滚区域特有的两件事：
// 首次挂载直接送到最新，以及用 ResizeObserver 盯内容高度（工具块展开、
// Markdown 渲染完成、图片与图表落地都会改高度，看文本会漏）。
//
// 返回的 following 供界面据此显示回底按钮，点一下即恢复跟随。

export function useStickToBottom(options: {
  scrollRef: React.RefObject<HTMLElement | null>
  contentRef?: React.RefObject<HTMLElement | null>
  enabled: boolean
}) {
  const { scrollRef, contentRef, enabled } = options
  const { following, setFollowing, schedulePin, scrollToBottom } = useStickFollow({ scrollRef, enabled })

  React.useEffect(() => {
    const el = scrollRef.current
    if (!enabled || !el) return

    // 首次挂载默认贴底：直接把视口送到最新，再开始按真实滚动事件判定。
    // （这一步不能省：内容一挂上就超过一屏时，首次判定会把默认贴底推翻。）
    setFollowing(true)
    scrollToBottom()

    const observer = new ResizeObserver(schedulePin)
    observer.observe(el)
    const content = contentRef?.current
    if (content) observer.observe(content)
    return () => observer.disconnect()
  }, [enabled, scrollRef, contentRef, setFollowing, scrollToBottom, schedulePin])

  return { following, scrollToBottom }
}
