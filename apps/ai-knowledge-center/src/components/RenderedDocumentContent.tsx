import * as React from 'react'
import { renderDocumentContentInto } from '../render/documentContent'

type RenderedDocumentContentProps = {
  content: string
}

export function RenderedDocumentContent(props: RenderedDocumentContentProps) {
  const { content } = props
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  React.useLayoutEffect(() => {
    if (!contentRef.current) return
    renderDocumentContentInto(contentRef.current, content)
  }, [content])

  return <div ref={contentRef} className="kc-content fw-rendered-content" aria-label="笔记正文" />
}
