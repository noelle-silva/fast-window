import * as React from 'react'

// 流式期间整段 Markdown 重解析（解析 + 消毒 + 增强）是主要开销：
// 内容越长，逐字全量重算越慢。这里按固定节奏合并渲染，给主线程留出余量，
// 同时保证最后一次内容一定落地，不影响最终结果。
const STREAM_RENDER_INTERVAL_MS = 100

export function AssistantMessageHost(props: {
  controller: any
  className?: string
  text: string
  mid: string
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
  streaming?: boolean
}) {
  const { controller, className, text, mid, renderSafetyPolicyKey, chatRootRef, streaming } = props
  const ref = React.useRef<HTMLDivElement | null>(null)
  const lastRenderAtRef = React.useRef(0)
  const lastTextRef = React.useRef<string | null>(null)
  const lastPolicyRef = React.useRef(renderSafetyPolicyKey)
  const pendingTextRef = React.useRef(text)
  const timerRef = React.useRef(0)

  const renderNow = React.useCallback(
    (value: string) => {
      if (!ref.current) return
      if (lastTextRef.current === value && lastPolicyRef.current === renderSafetyPolicyKey) return
      lastTextRef.current = value
      lastPolicyRef.current = renderSafetyPolicyKey
      lastRenderAtRef.current = performance.now()
      controller.renderAssistantInto(ref.current, value)
    },
    [controller, renderSafetyPolicyKey],
  )

  React.useLayoutEffect(() => {
    pendingTextRef.current = text
    if (!ref.current) return
    // 安全策略变化必须立即重渲染，不能因文本未变被去重挡下。
    const policyChanged = lastPolicyRef.current !== renderSafetyPolicyKey
    const interval = streaming && !policyChanged ? STREAM_RENDER_INTERVAL_MS : 0
    const elapsed = performance.now() - lastRenderAtRef.current
    if (elapsed >= interval) {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = 0
      }
      renderNow(text)
      return
    }
    if (timerRef.current) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0
      renderNow(pendingTextRef.current)
    }, interval - elapsed)
  }, [controller, text, renderSafetyPolicyKey, streaming, renderNow])

  React.useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const onClick = React.useCallback((e: React.MouseEvent) => {
    const t = e.target as any
    const root = chatRootRef.current
    if (!root || !(t instanceof Element)) return
    if (t.closest?.('[data-stop="1"]')) return
    const block = t.closest?.('.mermaid-block[data-mermaid="1"]')
    if (!block) return
    controller.actions.openMermaidViewer(root, block)
  }, [chatRootRef, controller])

  return <div className={className} data-mid={mid} ref={ref} onClick={onClick} />
}
