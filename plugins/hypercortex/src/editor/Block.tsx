import React from 'react'
import { createMarkdownRenderEngine } from '../render/engine'

const engine = createMarkdownRenderEngine()

export interface BlockProps {
  /** 该块的 Markdown 源码 */
  markdown: string
  /** 是否处于编辑态 */
  editing: boolean
  /** 点击渲染态 → 请求进入编辑态 */
  onRequestEdit: () => void
  /** 编辑态内容变化 */
  onChange: (value: string) => void
  /** 编辑态失焦 → 请求退出编辑态 */
  onBlur: () => void
  /** 编辑态按键（用于块间导航、分块等） */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  /** 获取 textarea ref（用于外部聚焦） */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  /** placeholder（仅对第一个空块生效） */
  placeholder?: string
}

/**
 * 单个块：渲染层始终存在撑高度，编辑态时 textarea 叠在上面。
 *
 * 核心机制：
 * - 外壳 div 用 position: relative，尺寸永远由渲染层决定
 * - 编辑态时渲染层 visibility: hidden（仍占空间），textarea absolute 铺满
 * - textarea 继承渲染产物首元素的字体样式（fontSize/fontWeight/lineHeight）
 * - 位置零跳动，字体视觉一致
 */
export const Block = React.memo(function Block({
  markdown,
  editing,
  onRequestEdit,
  onChange,
  onBlur,
  onKeyDown,
  textareaRef,
  placeholder,
}: BlockProps) {
  const renderRef = React.useRef<HTMLDivElement>(null)
  const localTextareaRef = React.useRef<HTMLTextAreaElement>(null)
  const taRef = textareaRef ?? localTextareaRef

  // 仅字体相关样式，从渲染产物继承
  const [fontStyle, setFontStyle] = React.useState<React.CSSProperties>({})

  // ── 渲染层：始终渲染 markdown ──
  React.useEffect(() => {
    if (!renderRef.current) return
    const el = renderRef.current
    const trimmed = markdown.trim()
    if (!trimmed) {
      el.innerHTML = ''
      return
    }
    try {
      engine.renderInto(el, trimmed)
    } catch {
      el.textContent = trimmed
    }
  }, [markdown])

  // ── 进入编辑态时：捕获字体样式 + 聚焦 ──
  React.useEffect(() => {
    if (!editing) return

    // 从渲染产物读字体样式
    if (renderRef.current) {
      const target = renderRef.current.firstElementChild as HTMLElement | null
      if (target) {
        const computed = window.getComputedStyle(target)
        setFontStyle({
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          lineHeight: computed.lineHeight,
        })
      } else {
        setFontStyle({})
      }
    }

    const ta = taRef.current
    if (!ta) return
    // 延迟一帧等 fontStyle 生效后再聚焦
    requestAnimationFrame(() => {
      ta.focus()
    })
  }, [editing, taRef])

  // 空块占位
  if (!markdown.trim() && !editing) {
    return (
      <div
        className="hc-block-rendered hc-block-empty"
        onClick={onRequestEdit}
      >
        {placeholder && <span className="hc-block-placeholder">{placeholder}</span>}
      </div>
    )
  }

  return (
    <div className="hc-block-shell" style={{ position: 'relative' }}>
      {/* 渲染层：始终存在撑高度，编辑态时隐藏但保留占位 */}
      <div
        ref={renderRef}
        className="hc-render hc-block-rendered"
        style={editing ? { visibility: 'hidden' } : undefined}
        onClick={!editing ? onRequestEdit : undefined}
      />

      {/* 编辑层：absolute 铺满外壳 */}
      {editing && (
        <textarea
          ref={taRef}
          className="hc-block-editor"
          style={{
            ...fontStyle,
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
          }}
          value={markdown}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  )
})
