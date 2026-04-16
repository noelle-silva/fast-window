import React from 'react'
import { Block } from './Block'
import { ensureBlockEditorStyles } from './styles'

export interface BlockEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
}

/**
 * Markdown Live Preview 块编辑器
 *
 * 将文档按空行拆分为块，光标所在块显示 Markdown 源码（textarea），
 * 其余块用渲染引擎显示渲染产物。与 Obsidian 同理但不依赖 CM6。
 *
 * 采用半受控模式：
 * - 内部编辑直接更新 blocks 状态，通过 onChange 通知 React
 * - 外部 value 变化时（如加载新笔记），整体替换
 */
export const BlockEditor = React.memo(function BlockEditor({
  value,
  onChange,
  placeholder,
  minHeight = 200,
}: BlockEditorProps) {
  const [blocks, setBlocks] = React.useState<string[]>(() => splitBlocks(value))
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)

  // 记录上一次外部传入的 value，避免自身编辑触发的 onChange 回环
  const externalValueRef = React.useRef(value)
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange

  // 外部 value 变化（加载新笔记等）→ 重新拆块
  React.useEffect(() => {
    if (value === externalValueRef.current) return
    externalValueRef.current = value
    setBlocks(splitBlocks(value))
    setActiveIndex(null)
  }, [value])

  // blocks 变化 → 通知外部
  const notifyChange = React.useCallback((newBlocks: string[]) => {
    const joined = joinBlocks(newBlocks)
    externalValueRef.current = joined
    onChangeRef.current(joined)
  }, [])

  // 某块内容变化
  const handleBlockChange = React.useCallback((index: number, newContent: string) => {
    setBlocks(prev => {
      const next = [...prev]
      next[index] = newContent
      notifyChange(next)
      return next
    })
  }, [notifyChange])

  // 点击渲染态 → 进入编辑
  const handleRequestEdit = React.useCallback((index: number) => {
    setActiveIndex(index)
  }, [])

  // 失焦 → 退出编辑
  const handleBlur = React.useCallback(() => {
    setActiveIndex(null)
  }, [])

  // 点击编辑器空白区域 → 聚焦最后一个块或创建新块
  const handleContainerClick = React.useCallback((e: React.MouseEvent) => {
    // 只处理点击容器本身，不处理子元素
    if (e.target !== e.currentTarget) return
    const lastIndex = blocks.length - 1
    if (lastIndex >= 0) {
      setActiveIndex(lastIndex)
    }
  }, [blocks.length])

  return (
    <div
      className="hc-block-editor-container"
      style={{ minHeight, width: '100%', cursor: 'text' }}
      onClick={handleContainerClick}
      ref={() => ensureBlockEditorStyles()}
    >
      {blocks.map((md, i) => (
        <Block
          key={i}
          markdown={md}
          editing={activeIndex === i}
          onRequestEdit={() => handleRequestEdit(i)}
          onChange={val => handleBlockChange(i, val)}
          onBlur={handleBlur}
          placeholder={i === 0 && blocks.length === 1 ? placeholder : undefined}
        />
      ))}
    </div>
  )
})

/* ------------------------------------------------------------------ */
/*  工具函数                                                           */
/* ------------------------------------------------------------------ */

/** 按空行拆分文档为块 */
function splitBlocks(text: string): string[] {
  const s = (text || '').replace(/\r\n/g, '\n')
  if (!s) return ['']
  // 按连续空行拆分（保留块内的单个换行）
  const blocks = s.split(/\n{2,}/)
  return blocks.length ? blocks : ['']
}

/** 将块拼回完整文档 */
function joinBlocks(blocks: string[]): string {
  return blocks.join('\n\n')
}
