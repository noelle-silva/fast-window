import * as React from 'react'

export function AssistantMessageHost(props: {
  controller: any
  className?: string
  text: string
  mid: string
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
}) {
  const { controller, className, text, mid, renderSafetyPolicyKey, chatRootRef } = props
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useLayoutEffect(() => {
    if (!ref.current) return
    controller.renderAssistantInto(ref.current, text)
  }, [controller, text, renderSafetyPolicyKey])

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
