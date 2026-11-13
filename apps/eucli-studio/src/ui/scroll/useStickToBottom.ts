import * as React from 'react'

// 自滚区域的跟底：内容还在增长时，只要视口贴着底部就继续贴住；
// 用户主动往上滚就交还控制权，滚回底部再恢复跟随。
//
// 判定与写法沿用思考面板那一套（阈值 24px、rAF 合并成一次写入），
// 差别只在「内容变化」的来源：工作过程里的高度变化可能来自工具块展开、
// Markdown 渲染完成，单看文本变化会漏，所以这里交给 ResizeObserver。

/** 距离底部多少像素以内算贴底。 */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 24

export function useStickToBottom(options: {
  scrollRef: React.RefObject<HTMLElement | null>
  contentRef?: React.RefObject<HTMLElement | null>
  enabled: boolean
}) {
  const { scrollRef, contentRef, enabled } = options
  const stickRef = React.useRef(true)
  const frameRef = React.useRef(0)

  React.useEffect(() => {
    const el = scrollRef.current
    if (!enabled || !el) return

    // 只认真实滚动事件：内容自然增高不算用户上滚。
    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })

    // 一帧最多写一次；同一帧里的多次增量只保留最后一次调度。
    const pin = () => {
      if (!stickRef.current || frameRef.current) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        const node = scrollRef.current
        if (!node || !stickRef.current) return
        node.scrollTop = node.scrollHeight
      })
    }

    const observer = new ResizeObserver(pin)
    observer.observe(el)
    const content = contentRef?.current
    if (content) observer.observe(content)

    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    }
  }, [enabled, scrollRef, contentRef])
}
