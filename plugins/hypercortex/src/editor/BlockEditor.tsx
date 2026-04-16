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

  // 点击块间间隙或底部空白 → 进入最近的块
  const handleContainerClick = React.useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return
    const container = e.currentTarget as HTMLElement
    const children = container.children
    if (!children.length) return

    const clickY = e.clientY
    let closest = 0
    let minDist = Infinity

    for (let j = 0; j < children.length; j++) {
      const rect = children[j].getBoundingClientRect()
      const center = (rect.top + rect.bottom) / 2
      const dist = Math.abs(clickY - center)
      if (dist < minDist) {
        minDist = dist
        closest = j
      }
    }

    setActiveIndex(closest)
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

/** 智能分块：逐行扫描，多行结构（代码块/表格/列表/引用）整体成块，其余每行独立 */
function splitBlocks(text: string): string[] {
  const s = (text || '').replace(/\r\n/g, '\n')
  if (!s) return ['']

  const lines = s.split('\n')
  const blocks: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 空行 → 跳过，不生成块（joinBlocks 用 \n\n 补回）
    if (!line.trim()) {
      i++
      continue
    }

    // 围栏代码块：``` 或 ~~~ 开头，收集到闭合栏
    const fenceMatch = line.match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      const fence = fenceMatch[1]
      const group = [line]
      i++
      while (i < lines.length) {
        group.push(lines[i])
        if (lines[i].trimEnd() === fence) { i++; break }
        i++
      }
      blocks.push(group.join('\n'))
      continue
    }

    // 表格：| 开头的连续行
    if (line.startsWith('|')) {
      const group = [line]
      i++
      while (i < lines.length && lines[i].startsWith('|')) {
        group.push(lines[i])
        i++
      }
      blocks.push(group.join('\n'))
      continue
    }

    // 列表：- / * / + / 数字. 开头，含缩进续行
    if (/^(\s*[-*+]|\s*\d+\.)\s/.test(line)) {
      const group = [line]
      i++
      while (i < lines.length) {
        const next = lines[i]
        // 列表项或缩进续行
        if (/^(\s*[-*+]|\s*\d+\.)\s/.test(next) || /^[ \t]{2,}\S/.test(next)) {
          group.push(next)
          i++
        } else break
      }
      blocks.push(group.join('\n'))
      continue
    }

    // 引用块：> 开头的连续行
    if (line.startsWith('>')) {
      const group = [line]
      i++
      while (i < lines.length && lines[i].startsWith('>')) {
        group.push(lines[i])
        i++
      }
      blocks.push(group.join('\n'))
      continue
    }

    // 普通行：独立成块
    blocks.push(line)
    i++
  }

  return blocks.length ? blocks : ['']
}

/** 将块拼回完整文档 */
function joinBlocks(blocks: string[]): string {
  return blocks.join('\n\n')
}
