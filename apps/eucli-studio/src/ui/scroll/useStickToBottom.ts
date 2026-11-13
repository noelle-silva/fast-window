import * as React from 'react'

// 自滚区域的跟底：内容还在增长时，只要视口贴着底部就继续贴住；
// 用户主动往上滚就交还控制权，滚回底部再恢复跟随。
//
// 判定与写法沿用思考面板那一套（阈值 24px、rAF 合并成一次写入），
// 差别只在「内容变化」的来源：工作过程里的高度变化可能来自工具块展开、
// Markdown 渲染完成，单看文本变化会漏，所以这里交给 ResizeObserver。
//
// 除了维护「是否贴底」，这里还把状态与「立刻回到底部」的命令交出去：
// 视口离底部时界面要能据此显示一个回底按钮，点一下即恢复跟随。

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
  // 与 stickRef 同源：ref 供事件里即时判断，state 供界面按需重绘（只在跨过阈值时变）。
  const [atBottom, setAtBottom] = React.useState(true)

  // 回到底部并恢复跟随：内容还在持续增长时，后续增量会由贴底逻辑继续接住。
  const scrollToBottom = React.useCallback(() => {
    stickRef.current = true
    setAtBottom(true)
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [scrollRef])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!enabled || !el) return

    // 首次挂载默认贴底：直接把视口送到最新，再开始按真实滚动事件判定。
    // （这一步不能省：内容一挂上就超过一屏时，首次判定会把默认贴底推翻。）
    stickRef.current = true
    setAtBottom(true)
    el.scrollTop = el.scrollHeight

    // 只认真实滚动事件：内容自然增高不算用户上滚。
    const onScroll = () => {
      const next = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX
      stickRef.current = next
      setAtBottom((current) => (current === next ? current : next))
    }
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

  return { atBottom, scrollToBottom }
}
