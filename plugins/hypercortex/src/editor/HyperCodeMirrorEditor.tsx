import React from 'react'

export interface UnifiedEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  /** 渲染覆盖层中每个 block 渲染完成后的后处理钩子（如资源解析）。第二个参数 requestUpdate 用于异步内容就绪后请求重新布局。 */
  onBlockRendered?: (el: HTMLElement, requestUpdate: () => void) => void
}

/**
 * 新编辑器占位实现：先把旧的“双层翻牌”机制下线，确保项目能编译。
 * 后续会在这里接入 HyperCodeMirror。
 */
export const HyperCodeMirrorEditor = React.memo(function HyperCodeMirrorEditor({
  minHeight = 200,
}: UnifiedEditorProps) {
  return <div style={{ minHeight }} />
})

