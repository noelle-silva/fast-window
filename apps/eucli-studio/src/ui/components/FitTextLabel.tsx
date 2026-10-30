import * as React from 'react'

// 固定宽度内自适应字号：按最大字号测量文本自然宽度，超宽时等比缩小；
// 缩到最小字号仍放不下才省略，保证极限范围内模型标识始终完整可读。
export function FitTextLabel(props: {
  text: string
  maxFontSize: number
  minFontSize: number
  fontWeight?: number
}) {
  const { text, maxFontSize, minFontSize, fontWeight = 800 } = props
  const hostRef = React.useRef<HTMLSpanElement | null>(null)
  const [fontSize, setFontSize] = React.useState(maxFontSize)

  React.useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    const fit = () => {
      const available = host.clientWidth
      if (!available || !text) return

      // 用一次离屏测量拿自然宽度，避免反复改字号触发重排。
      const probe = document.createElement('span')
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.whiteSpace = 'nowrap'
      probe.style.fontWeight = String(fontWeight)
      probe.style.fontFamily = getComputedStyle(host).fontFamily
      probe.style.fontSize = `${maxFontSize}px`
      probe.textContent = text
      document.body.appendChild(probe)
      const natural = probe.scrollWidth
      document.body.removeChild(probe)
      if (!natural) return

      const scaled = maxFontSize * (available / natural)
      setFontSize(Math.max(minFontSize, Math.min(maxFontSize, scaled)))
    }

    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(host)
    return () => ro.disconnect()
  }, [text, maxFontSize, minFontSize, fontWeight])

  return (
    <span
      ref={hostRef}
      style={{
        display: 'block',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize,
        fontWeight,
        lineHeight: 1.2,
      }}
    >
      {text}
    </span>
  )
}
