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

/** 单个块：编辑态 = textarea，渲染态 = renderInto 产物 */
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

  // 从渲染态 DOM 捕获的样式，让 textarea 继承渲染产物的视觉尺寸
  const [editStyle, setEditStyle] = React.useState<React.CSSProperties>({})

  // ── 渲染态：用渲染引擎把 markdown 渲染到 DOM ──
  React.useEffect(() => {
    if (editing || !renderRef.current) return
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
  }, [markdown, editing])

  // ── 编辑态：自动聚焦 + 自动高度 ──
  React.useEffect(() => {
    if (!editing) return
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    autoResize(ta)
  }, [editing, taRef])

  // 点击渲染态 → 捕获样式 → 请求编辑
  const handleRequestEdit = React.useCallback(() => {
    if (renderRef.current) {
      const target = renderRef.current.firstElementChild as HTMLElement | null
      if (target) {
        const computed = window.getComputedStyle(target)
        setEditStyle({
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          lineHeight: computed.lineHeight,
        })
      } else {
        setEditStyle({})
      }
    }
    onRequestEdit()
  }, [onRequestEdit])

  if (editing) {
    return (
      <textarea
        ref={taRef}
        className="hc-block-editor"
        style={editStyle}
        value={markdown}
        placeholder={placeholder}
        onChange={e => {
          onChange(e.target.value)
          autoResize(e.target)
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        rows={1}
      />
    )
  }

  // 渲染态：空块显示占位
  if (!markdown.trim()) {
    return (
      <div
        className="hc-block-rendered hc-block-empty"
        onClick={handleRequestEdit}
      >
        {placeholder && <span className="hc-block-placeholder">{placeholder}</span>}
      </div>
    )
  }

  return (
    <div
      ref={renderRef}
      className="hc-render hc-block-rendered"
      onClick={handleRequestEdit}
    />
  )
})

/** textarea 自动高度 */
function autoResize(ta: HTMLTextAreaElement) {
  ta.style.height = '0'
  ta.style.height = ta.scrollHeight + 'px'
}
