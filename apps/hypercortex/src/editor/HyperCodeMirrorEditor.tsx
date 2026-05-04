import React from 'react'
import { ensureHyperCodeMirrorEditorStyles } from './styles'
import { parseNotePlaceholderBody } from '../notePlaceholder'

// CM6（新一代编辑器核心）
import { basicSetup } from 'codemirror'
import { EditorState, StateEffect, StateField, type Range, type Text } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  placeholder as cmPlaceholder,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

export interface UnifiedEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  /** 是否处于可见/活跃态：用于 tab 切换后触发一次测量，避免隐藏期间布局漂移。 */
  active?: boolean
  /** 外部触发一次“重建装饰/预览”的信号（例如 noteIndex 更新后要刷新标题渲染）。 */
  refreshToken?: unknown
  /** widget 渲染完成后的后处理钩子（如资源解析）。第二个参数 requestUpdate 用于异步内容就绪后请求重新布局。 */
  onBlockRendered?: (el: HTMLElement, requestUpdate: () => void) => void
  writeClipboardText?: (text: string) => Promise<void>
  showToast?: (message: string) => Promise<void> | void
}

type LiveBlockKind = 'latex' | 'mermaid' | 'code' | 'table'
type LiveBlock = { from: number; to: number; focusTo: number; kind: LiveBlockKind; source: string }
type AssetPlaceholder = { from: number; to: number; line: number; inline: boolean; source: string; ext: string }

const refreshEffect = StateEffect.define<number>()
let globalWriteClipboardText: UnifiedEditorProps['writeClipboardText'] | undefined
let globalShowToast: UnifiedEditorProps['showToast'] | undefined

function requestCmLayout(view: EditorView) {
  try {
    // CM6 的高度映射/行号定位依赖测量周期；当 widget 内容异步变高（Mermaid/图片/资源解析等）
    // 若不触发一次 measure，后续行号与内容可能出现“错位漂移”。
    view.requestMeasure({
      read: () => null,
      write: () => {},
    })
  } catch (_) {
    // ignore
  }
}

function sliceLineEndWithBreak(doc: Text, line: { to: number; number: number }) {
  // Text 以 '\n' 作为换行，line.to 不包含换行符
  return line.number < doc.lines ? line.to + 1 : line.to
}

function scanLiveBlocks(doc: Text): LiveBlock[] {
  const blocks: LiveBlock[] = []
  const isFenceOpen = (t: string) => /^\s*```([A-Za-z0-9_-]+)?\s*$/.exec(t)
  const isFenceClose = (t: string) => /^\s*```\s*$/.test(t)
  const isLatexMarkerLine = (t: string) => String(t || '').trim() === '$$'
  const isSingleLineLatex = (t: string) => /^\s*\$\$[\s\S]*\$\$\s*$/.test(t) && !isLatexMarkerLine(t)

  for (let ln = 1; ln <= doc.lines; ln++) {
    const line = doc.line(ln)
    const text = line.text

    // Mermaid fenced block: ```mermaid ... ```
    const open = isFenceOpen(text)
    if (open) {
      const lang = String(open[1] || '').trim().toLowerCase()
      const isMermaid = lang === 'mermaid'
      let endLn = -1
      for (let j = ln + 1; j <= doc.lines; j++) {
        const l2 = doc.line(j)
        if (isFenceClose(l2.text)) { endLn = j; break }
      }
      if (endLn !== -1) {
        const startLine = doc.line(ln)
        const endLine = doc.line(endLn)
        const from = startLine.from
        const to = sliceLineEndWithBreak(doc, endLine)
        blocks.push({
          from,
          to,
          focusTo: endLine.to,
          kind: isMermaid ? 'mermaid' : 'code',
          source: doc.sliceString(from, to),
        })
        ln = endLn
        continue
      }
    }

    // LaTeX block: $$ ... $$（优先识别“独占一行”的标记）
    if (isLatexMarkerLine(text)) {
      let endLn = -1
      for (let j = ln + 1; j <= doc.lines; j++) {
        const l2 = doc.line(j)
        if (isLatexMarkerLine(l2.text)) { endLn = j; break }
      }
      if (endLn !== -1) {
        const startLine = doc.line(ln)
        const endLine = doc.line(endLn)
        const from = startLine.from
        const to = sliceLineEndWithBreak(doc, endLine)
        blocks.push({ from, to, focusTo: endLine.to, kind: 'latex', source: doc.sliceString(from, to) })
        ln = endLn
        continue
      }
    }

    // 单行 $$...$$（补一个小口子，体验更顺）
    if (isSingleLineLatex(text)) {
      const from = line.from
      const to = sliceLineEndWithBreak(doc, line)
      blocks.push({ from, to, focusTo: line.to, kind: 'latex', source: doc.sliceString(from, to) })
      continue
    }

    // 表格：第一行必须 | 开头，后续行 | 开头或纯分隔线 |---|
    if (/^\s*\|/.test(text)) {
      let endLn = ln
      for (let j = ln + 1; j <= doc.lines; j++) {
        const jt = doc.line(j).text
        if (/^\s*\|/.test(jt) || /^[\s|:-]+$/.test(jt) && jt.includes('|')) endLn = j
        else break
      }
      if (endLn > ln) {
        const startLine = doc.line(ln)
        const endLine = doc.line(endLn)
        const from = startLine.from
        const to = sliceLineEndWithBreak(doc, endLine)
        blocks.push({ from, to, focusTo: endLine.to, kind: 'table', source: doc.sliceString(from, to).trim() })
        ln = endLn
        continue
      }
    }
  }

  return blocks
}

const RE_ASSET_MARKER = /\{\{asset:[^}]+?\}\}/g
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'])

function assetMarkerExt(marker: string): string {
  // marker: {{asset:REF||width}} or {{asset:REF|name|width}} or {{asset:REF}}
  const m = /^\{\{asset:([\s\S]+?)\}\}$/.exec(String(marker || '').trim())
  if (!m) return ''
  const body = String(m[1] || '').trim()
  if (!body) return ''
  const dbl = body.indexOf('||')
  const head = (dbl >= 0 ? body.slice(0, dbl) : body.split('|')[0] || '').trim()
  if (!head) return ''
  const dot = head.lastIndexOf('.')
  if (dot < 0) return ''
  return head.slice(dot + 1).toLowerCase()
}

function scanAssetPlaceholders(doc: Text): AssetPlaceholder[] {
  const out: AssetPlaceholder[] = []
  const open = (t: string) => /^\s*(`{3,}|~{3,})/.exec(t)
  const isClose = (t: string, marker: string) => {
    const ch = marker[0]
    let count = 0
    while (count < t.length && t[count] === ch) count++
    if (count < marker.length) return false
    for (let i = count; i < t.length; i++) {
      if (t[i] !== ' ' && t[i] !== '\t') return false
    }
    return true
  }

  let inFence = false
  let fenceMarker = ''

  for (let ln = 1; ln <= doc.lines; ln++) {
    const line = doc.line(ln)
    const text = line.text

    if (inFence) {
      if (isClose(text.trimEnd(), fenceMarker)) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }

    const m = open(text.trimEnd())
    if (m) {
      inFence = true
      fenceMarker = m[1]
      continue
    }

    const codeRanges = findInlineCodeRanges(text)
    const inCode = (idx: number) => codeRanges.some(([a, b]) => idx >= a && idx < b)

    RE_ASSET_MARKER.lastIndex = 0
    for (let mm = RE_ASSET_MARKER.exec(text); mm; mm = RE_ASSET_MARKER.exec(text)) {
      const raw = mm[0] || ''
      const at = mm.index
      if (at < 0) continue
      if (inCode(at)) continue

      const marker = raw.trim()
      const inline = text.trim() !== marker

      out.push({
        from: line.from + at,
        to: line.from + at + raw.length,
        line: ln,
        inline,
        source: marker,
        ext: assetMarkerExt(marker),
      })
    }
  }

  return out
}

function selectionIntersects(sel: { from: number; to: number; head: number }, block: { from: number; focusTo: number }) {
  // 光标（空选区）：边界也算”进入块内”，这样点击预览会立刻展开源码
  if (sel.from === sel.to) return sel.head >= block.from && sel.head <= block.focusTo
  // 选区：只要有交集就视为”在块内”
  return sel.from <= block.focusTo && sel.to >= block.from
}

type NoteIndexMap = Record<string, { title: string }>
type NoteRefRange = { from: number; to: number; noteId: string; title: string; remarks: string }

const NOTE_REF_PATTERN = /\[\[([^\]\n]+?)\]\]/g

function getGlobalNoteIndexMap(): NoteIndexMap | null {
  const engine = (window as any)?.__hcRenderEngine
  const ni = engine?.noteIndex
  return ni && typeof ni === 'object' ? (ni as NoteIndexMap) : null
}

function findNoteRefRanges(lineText: string, codeRanges: Array<[number, number]>): NoteRefRange[] {
  const out: NoteRefRange[] = []
  NOTE_REF_PATTERN.lastIndex = 0

  const inCode = (idx: number) => codeRanges.some(([a, b]) => idx >= a && idx < b)

  for (let m = NOTE_REF_PATTERN.exec(lineText); m; m = NOTE_REF_PATTERN.exec(lineText)) {
    const raw = m[0] ?? ''
    const at = m.index
    if (at < 0) continue
    if (!raw) continue
    if (inCode(at)) continue

    const inner = String(m[1] ?? '').trim()
    const parsed = parseNotePlaceholderBody(inner)
    if (!parsed?.noteId) continue

    const noteId = String(parsed.noteId || '').trim()
    if (!noteId) continue

    out.push({
      from: at,
      to: at + raw.length,
      noteId,
      title: String(parsed.title || ''),
      remarks: String(parsed.remarks || ''),
    })
  }

  return out
}

class BulletWidget extends WidgetType {
  constructor(readonly indent: number) { super() }
  eq(other: WidgetType) { return other instanceof BulletWidget && other.indent === this.indent }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-hc-bullet'
    span.textContent = '\u2002'.repeat(this.indent) + '•\u2002'
    return span
  }
}

async function copyTextToClipboard(text: string, writeClipboardText?: (text: string) => Promise<void>) {
  const t = String(text || '')
  if (!t) return false
  try {
    if (typeof writeClipboardText === 'function') { await writeClipboardText(t); return true }
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(t); return true }
  } catch (_) {}
  try {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return !!ok
  } catch (_) {}
  return false
}

function findInlineMathRanges(lineText: string, codeRanges: Array<[number, number]>) {
  const ranges: Array<{ from: number; to: number; tex: string }> = []
  const isEscaped = (i: number) => i > 0 && lineText[i - 1] === '\\'
  const inCode = (i: number) => codeRanges.some(([a, b]) => i >= a && i < b)

  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] !== '$') continue
    if (isEscaped(i)) continue
    if (inCode(i)) continue
    if (lineText[i + 1] === '$') continue // 跳过 $$（块公式/行间公式）

    // 找右侧闭合 $
    let j = i + 1
    for (; j < lineText.length; j++) {
      if (lineText[j] !== '$') continue
      if (isEscaped(j)) continue
      if (inCode(j)) continue
      if (lineText[j - 1] === '$') continue // 避免 $$ 右半边
      break
    }
    if (j >= lineText.length) break

    const inner = lineText.slice(i + 1, j)
    const tex = inner.trim()
    if (!tex) { i = j; continue }

    ranges.push({ from: i, to: j + 1, tex })
    i = j
  }

  return ranges
}

function findInlineCodeRanges(lineText: string) {
  const ranges: Array<[number, number]> = []
  let i = 0
  while (i < lineText.length) {
    if (lineText[i] !== '`') { i++; continue }
    const start = i
    i++
    for (; i < lineText.length; i++) {
      if (lineText[i] !== '`') continue
      const end = i + 1
      ranges.push([start, end])
      i = end
      break
    }
  }
  return ranges
}

class InlineMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly writeClipboardText: (() => UnifiedEditorProps['writeClipboardText']) | undefined,
    readonly showToast: (() => UnifiedEditorProps['showToast']) | undefined,
  ) { super() }
  eq(other: WidgetType) { return other instanceof InlineMathWidget && other.tex === this.tex }
  toDOM(view: EditorView) {
    const span = document.createElement('span')
    span.className = 'cm-hc-inline-math math-inline fw-math-host'
    span.setAttribute('data-tex', this.tex)

    const inner = document.createElement('span')
    inner.className = 'cm-hc-inline-math-inner'

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'fw-math-copy'
    btn.setAttribute('aria-label', '复制 LaTeX 公式')
    btn.textContent = '⧉'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      copyTextToClipboard(`$${this.tex}$`, this.writeClipboardText?.())
        .then((ok) => { if (ok) { try { void this.showToast?.()?.('已复制公式') } catch (_) {} } })
        .catch(() => {})
    })
    span.appendChild(inner)
    span.appendChild(btn)

    const w = window as any
    const katex = w?.katex
    if (katex && typeof katex.render === 'function') {
      try { katex.render(this.tex, inner, { displayMode: false, throwOnError: false }) } catch (_) { inner.textContent = this.tex }
    } else {
      inner.textContent = this.tex
    }
    // 公式字体/布局可能在下一帧才稳定，触发一次测量避免高度映射滞后
    requestAnimationFrame(() => requestCmLayout(view))
    return span
  }
  ignoreEvent(e: Event) {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest?.('button, a, input, textarea, select')) return true
    return false
  }
}

class InlineNoteRefWidget extends WidgetType {
  constructor(
    readonly noteId: string,
    readonly label: string,
    readonly broken: boolean,
    readonly remarks: string,
  ) { super() }
  eq(other: WidgetType) {
    return other instanceof InlineNoteRefWidget
      && other.noteId === this.noteId
      && other.label === this.label
      && other.broken === this.broken
      && other.remarks === this.remarks
  }
  toDOM() {
    const el = document.createElement('a')
    el.className = this.broken ? 'hc-note-ref hc-note-ref--broken' : 'hc-note-ref'
    el.setAttribute('data-note-id', this.noteId)
    if (this.remarks) el.setAttribute('data-note-remarks', this.remarks)
    el.textContent = this.broken ? `不存在笔记：${this.label}` : this.label
    return el
  }
  ignoreEvent(e: Event) {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest?.('button,input,textarea,select')) return true
    // 让点击时能落光标、并触发“进入该行 -> 还原源码”。
    return false
  }
}

const syntaxHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
      const hasRefresh = update.transactions.some(tr => tr.effects.some(e => e.is(refreshEffect)))
      if (update.docChanged || update.selectionSet || hasRefresh) {
        this.decorations = this.build(update.view)
      }
    }

    private build(view: EditorView): DecorationSet {
      const doc = view.state.doc
      const decos: Range<Decoration>[] = []

      const sel = view.state.selection.main
      const cursorLine = doc.lineAt(sel.head).number
      const noteIndexMap = getGlobalNoteIndexMap()

      const mark = (from: number, to: number, cls: string) => {
        if (from < to) decos.push(Decoration.mark({ class: cls }).range(from, to))
      }
      const lineDeco = (pos: number, cls: string) => {
        decos.push(Decoration.line({ class: cls }).range(pos))
      }

      const liveBlocks = scanLiveBlocks(doc)

      const lineInfo = new Map<number, string>()
      for (const b of liveBlocks) {
        const focused = selectionIntersects({ from: sel.from, to: sel.to, head: sel.head }, b)
        const startLn = doc.lineAt(b.from).number
        const endLn = doc.lineAt(b.focusTo).number
        for (let ln = startLn; ln <= endLn; ln++) {
          if (!focused) {
            lineInfo.set(ln, 'skip')
          } else if (b.kind === 'code') {
            if (ln === startLn) lineInfo.set(ln, 'fence-open')
            else if (ln === endLn) lineInfo.set(ln, 'fence-close')
            else lineInfo.set(ln, 'fence-body')
          } else {
            lineInfo.set(ln, 'raw')
          }
        }
      }

      const boldRe = /\*\*(.+?)\*\*/g
      const italicRe = /(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g
      const inlineCodeRe = /`([^`]*?)`/g
      const strikeRe = /~~(.+?)~~/g
      const imageRe = /!\[([^\]]*)\]\(([^)]*)\)/g
      const linkRe = /\[([^\]]*)\]\(([^)]*)\)/g

      for (let ln = 1; ln <= doc.lines; ln++) {
        const info = lineInfo.get(ln)
        if (info === 'skip' || info === 'raw') continue

        const line = doc.line(ln)
        const base = line.from
        const focused = ln === cursorLine

        if (info === 'fence-open') {
          lineDeco(base, 'cm-hc-fence-open')
          continue
        }
        if (info === 'fence-close') {
          lineDeco(base, 'cm-hc-fence-close')
          continue
        }
        if (info === 'fence-body') {
          lineDeco(base, 'cm-hc-fence-body')
          continue
        }

        const t = line.text
        const dimOrHide = focused ? 'cm-hc-dim' : 'cm-hc-hide'

        // 标题：非聚焦行隐藏 # 和空格
        const hm = /^(#{1,6}) (.*)$/.exec(t)
        if (hm) {
          const level = hm[1].length
          mark(base, base + level + 1, dimOrHide)
          const cls = level <= 3
            ? (level === 1 ? 'cm-hc-h1' : level === 2 ? 'cm-hc-h2' : 'cm-hc-h3')
            : 'cm-hc-h4'
          mark(base + level + 1, base + t.length, cls)
        }

        // 水平线
        if (/^([-*_]{3,})\s*$/.test(t)) {
          lineDeco(base, 'cm-hc-hr-line')
          if (!focused) mark(base, base + t.length, 'cm-hc-hr-text-hidden')
          continue
        }

        // 引用
        const bqm = /^(>\s?)(.*)$/.exec(t)
        if (bqm) {
          mark(base, base + (bqm[1] ?? '').length, 'cm-hc-blockquote-marker')
          mark(base, base + t.length, 'cm-hc-blockquote')
        }

        // 列表标记
        const ulm = /^(\s*)([-*+])(\s)/.exec(t)
        if (ulm) {
          const markerFrom = base
          const markerTo = base + ulm[0].length
          if (focused) {
            mark(markerFrom, markerTo, 'cm-hc-list-marker')
          } else {
            const indent = Math.floor((ulm[1] ?? '').length / 2)
            decos.push(Decoration.replace({ widget: new BulletWidget(indent) }).range(markerFrom, markerTo))
          }
        }
        const olm = /^(\s*\d+\.\s)/.exec(t)
        if (olm) mark(base, base + olm[1].length, 'cm-hc-list-marker')

        // 加粗
        boldRe.lastIndex = 0
        for (let m = boldRe.exec(t); m; m = boldRe.exec(t)) {
          const o = base + m.index
          const inner = m[1] ?? ''
          mark(o, o + 2, dimOrHide)
          mark(o + 2, o + 2 + inner.length, 'cm-hc-bold')
          mark(o + 2 + inner.length, o + 2 + inner.length + 2, dimOrHide)
        }

        // 斜体
        italicRe.lastIndex = 0
        for (let m = italicRe.exec(t); m; m = italicRe.exec(t)) {
          const prefix = m[1] ?? ''
          const inner = m[2] ?? ''
          const s = base + m.index + prefix.length
          mark(s, s + 1, dimOrHide)
          mark(s + 1, s + 1 + inner.length, 'cm-hc-italic')
          mark(s + 1 + inner.length, s + 1 + inner.length + 1, dimOrHide)
        }

        // 行内代码
        inlineCodeRe.lastIndex = 0
        for (let m = inlineCodeRe.exec(t); m; m = inlineCodeRe.exec(t)) {
          const o = base + m.index
          const inner = m[1] ?? ''
          mark(o, o + 1, dimOrHide)
          mark(o + 1, o + 1 + inner.length, 'cm-hc-inline-code')
          mark(o + 1 + inner.length, o + 1 + inner.length + 1, dimOrHide)
        }

        // 删除线
        strikeRe.lastIndex = 0
        for (let m = strikeRe.exec(t); m; m = strikeRe.exec(t)) {
          const o = base + m.index
          const inner = m[1] ?? ''
          mark(o, o + 2, dimOrHide)
          mark(o + 2, o + 2 + inner.length, 'cm-hc-strikethrough')
          mark(o + 2 + inner.length, o + 2 + inner.length + 2, dimOrHide)
        }

        // 图片
        const imgRanges: Array<[number, number]> = []
        imageRe.lastIndex = 0
        for (let m = imageRe.exec(t); m; m = imageRe.exec(t)) {
          const f = base + m.index, tt = f + m[0].length
          imgRanges.push([f, tt])
          mark(f, tt, focused ? 'cm-hc-image-marker' : 'cm-hc-hide')
        }

        // 链接
        linkRe.lastIndex = 0
        for (let m = linkRe.exec(t); m; m = linkRe.exec(t)) {
          const f = base + m.index, tt = f + m[0].length
          if (imgRanges.some(([a, b]) => f < b && tt > a)) continue
          const text = m[1] ?? '', url = m[2] ?? ''
          const ob = f
          mark(ob, ob + 1, dimOrHide)
          mark(ob + 1, ob + 1 + text.length, 'cm-hc-link-text')
          mark(ob + 1 + text.length, ob + 1 + text.length + 1, dimOrHide)
          const op = ob + 1 + text.length + 1
          mark(op, op + 1 + url.length + 1, focused ? 'cm-hc-link-url' : 'cm-hc-link-url-hide')
        }

        // 行内公式：仅在“非聚焦行”渲染成 KaTeX，避免打断正在编辑的那一行
        if (!focused && t.includes('$')) {
          const codeRanges = findInlineCodeRanges(t)
          const mathRanges = findInlineMathRanges(t, codeRanges)
          for (const r of mathRanges) {
            const from = base + r.from
            const to = base + r.to
            decos.push(Decoration.replace({ widget: new InlineMathWidget(r.tex, () => globalWriteClipboardText, () => globalShowToast) }).range(from, to))
          }
        }

        // 笔记引用占位符：仅在“非聚焦行”替换渲染，点击即可回到源码编辑
        if (!focused && t.includes('[[')) {
          const codeRanges = findInlineCodeRanges(t)
          const refs = findNoteRefRanges(t, codeRanges)
          if (refs.length) {
            for (const r of refs) {
              const from = base + r.from
              const to = base + r.to
              const meta = noteIndexMap ? noteIndexMap[r.noteId] : undefined
              const hasIndex = !!noteIndexMap
              const broken = hasIndex && !meta
              const label = String(r.title || '').trim()
                || String(meta?.title || '').trim()
                || '未知笔记'
              decos.push(Decoration.replace({ widget: new InlineNoteRefWidget(r.noteId, label, broken, r.remarks) }).range(from, to))
            }
          }
        }
      }

      return Decoration.set(decos, true)
    }
  },
  { decorations: (v) => v.decorations },
)

class HyperBlockWidget extends WidgetType {
  constructor(
    readonly kind: LiveBlockKind,
    readonly source: string,
    readonly onBlockRendered: (() => UnifiedEditorProps['onBlockRendered']) | undefined,
  ) { super() }

  eq(other: WidgetType) {
    return other instanceof HyperBlockWidget && other.kind === this.kind && other.source === this.source
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'hc-cm6-preview'
    wrap.setAttribute('data-kind', this.kind)

    const inner = document.createElement('div')
    inner.className = 'hc-render'
    wrap.appendChild(inner)

    const engine = (window as any).__hcRenderEngine
    if (engine && typeof engine.renderInto === 'function') {
      engine.renderInto(inner, this.source, { onAsyncLayout: () => requestCmLayout(view) })
    } else {
      inner.textContent = this.source
    }

    const hook = this.onBlockRendered?.()
    if (hook) hook(inner, () => requestCmLayout(view))

    // 初次渲染也触发一次布局测量，避免某些情况下高度没及时“认领”
    requestCmLayout(view)

    return wrap
  }

  ignoreEvent(e: Event) {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest?.('button, a, input, textarea, select')) return true
    // 让点击预览时，光标能落在替换范围边界，从而“翻回源码”进入编辑态
    return false
  }
}

class AssetPlaceholderWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly onBlockRendered: (() => UnifiedEditorProps['onBlockRendered']) | undefined,
    readonly inline: boolean,
  ) { super() }

  eq(other: WidgetType) {
    return other instanceof AssetPlaceholderWidget && other.source === this.source && other.inline === this.inline
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement(this.inline ? 'span' : 'div')
    wrap.className = this.inline ? 'hc-cm6-inline-preview' : 'hc-cm6-preview'
    wrap.setAttribute('data-kind', this.inline ? 'asset-inline' : 'asset')

    const inner = document.createElement(this.inline ? 'span' : 'div')
    inner.className = 'hc-render'
    wrap.appendChild(inner)

    const engine = (window as any).__hcRenderEngine
    if (engine && typeof engine.renderInto === 'function') {
      engine.renderInto(inner, this.source, { onAsyncLayout: () => requestCmLayout(view), assetInline: this.inline })
    } else {
      inner.textContent = this.source
    }

    const hook = this.onBlockRendered?.()
    if (hook) hook(inner, () => requestCmLayout(view))

    requestCmLayout(view)

    return wrap
  }

  ignoreEvent(e: Event) {
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest?.('button, a, input, textarea, select, audio, video')) return true
    return false
  }
}

function livePreviewExtension(opts: { getOnBlockRendered?: () => UnifiedEditorProps['onBlockRendered'] }) {
  function buildDecos(state: EditorState): DecorationSet {
    const doc = state.doc
    const sel = state.selection.main
    const blocks = scanLiveBlocks(doc)
    const decos: Range<Decoration>[] = []
    for (const b of blocks) {
      if (selectionIntersects({ from: sel.from, to: sel.to, head: sel.head }, b)) continue
      const widget = new HyperBlockWidget(b.kind, b.source, opts.getOnBlockRendered)
      decos.push(Decoration.replace({ widget, block: true }).range(b.from, b.to))
    }
    return Decoration.set(decos, true)
  }

  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecos(state)
    },
    update(value, tr) {
      if (tr.docChanged || tr.selection) {
        return buildDecos(tr.state)
      }
      return value
    },
    provide: (f) => EditorView.decorations.from(f),
  })
}

function assetPreviewExtension(opts: { getOnBlockRendered?: () => UnifiedEditorProps['onBlockRendered'] }) {
  function buildDecos(state: EditorState): DecorationSet {
    const doc = state.doc
    const sel = state.selection.main
    const cursorLine = doc.lineAt(sel.head).number
    const assets = scanAssetPlaceholders(doc)
    const decos: Range<Decoration>[] = []

    for (const a of assets) {
      if (a.line === cursorLine) continue
      if (selectionIntersects({ from: sel.from, to: sel.to, head: sel.head }, { from: a.from, focusTo: a.to })) continue

      const forceBlock = IMAGE_EXTS.has(a.ext)
      const widget = new AssetPlaceholderWidget(a.source, opts.getOnBlockRendered, a.inline && !forceBlock)

      if (a.inline && !forceBlock) {
        decos.push(Decoration.replace({ widget }).range(a.from, a.to))
        continue
      }

      // 块级：
      // - 独占一行的占位符：替换整行（更稳定）
      // - 行内图片占位符：替换占位符本身，但以 block widget 插入（让图片自然“落到下一行”预览）
      if (!a.inline) {
        const line = doc.line(a.line)
        const from = line.from
        const to = sliceLineEndWithBreak(doc, line)
        decos.push(Decoration.replace({ widget, block: true }).range(from, to))
      } else {
        decos.push(Decoration.replace({ widget, block: true }).range(a.from, a.to))
      }
    }

    return Decoration.set(decos, true)
  }

  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecos(state)
    },
    update(value, tr) {
      if (tr.docChanged || tr.selection) {
        return buildDecos(tr.state)
      }
      return value
    },
    provide: (f) => EditorView.decorations.from(f),
  })
}

/**
 * HyperCodeMirrorEditor（新一代编辑器）
 *
 * - CodeMirror 6 作为文本编辑核心
 * - 扫描 Mermaid / LaTeX 块，光标不在块内时用 widget 做 Live Preview
 * - 光标进入块内时自动露出源码编辑
 * - 对外 props 保持与旧 UnifiedEditor 一致
 */
export const HyperCodeMirrorEditor = React.memo(function HyperCodeMirrorEditor({
  value,
  onChange,
  placeholder,
  minHeight = 200,
  active,
  refreshToken,
  onBlockRendered,
  writeClipboardText,
  showToast,
}: UnifiedEditorProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const viewRef = React.useRef<EditorView | null>(null)
  const isApplyingExternalRef = React.useRef(false)
  const onChangeRef = React.useRef(onChange)
  const onBlockRenderedRef = React.useRef(onBlockRendered)

  onChangeRef.current = onChange
  onBlockRenderedRef.current = onBlockRendered
  globalWriteClipboardText = writeClipboardText
  globalShowToast = showToast

  const liveExt = React.useMemo(() => {
    return livePreviewExtension({ getOnBlockRendered: () => onBlockRenderedRef.current })
  }, [])

  const assetExt = React.useMemo(() => {
    return assetPreviewExtension({ getOnBlockRendered: () => onBlockRenderedRef.current })
  }, [])

  React.useLayoutEffect(() => {
    ensureHyperCodeMirrorEditorStyles()

    const parent = hostRef.current
    if (!parent) return

    const updateListener = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return
      if (isApplyingExternalRef.current) return
      const next = u.state.doc.toString()
      onChangeRef.current(next)
    })

    const state = EditorState.create({
      doc: value ?? '',
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-multiline': 'true' }),
        placeholder ? cmPlaceholder(placeholder) : [],
        updateListener,
        syntaxHighlightPlugin,
        assetExt,
        liveExt,
      ],
    })

    const view = new EditorView({ state, parent })
    viewRef.current = view

    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [])

  // 外部 value 同步（加载新笔记 / 切换页面等）
  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    const next = String(value ?? '')
    if (cur === next) return

    isApplyingExternalRef.current = true
    try {
      const head = view.state.selection.main.head
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: { anchor: Math.min(head, next.length) },
      })
    } finally {
      // 下一帧再放开，避免极端情况下同一轮 updateListener 又触发
      requestAnimationFrame(() => { isApplyingExternalRef.current = false })
    }
  }, [value])

  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (active !== true) return
    try {
      view.requestMeasure({
        read: () => null,
        write: () => {},
      })
    } catch (_) {
      // ignore
    }
  }, [active])

  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return
    try {
      view.dispatch({ effects: refreshEffect.of(Date.now()) })
    } catch (_) {
      // ignore
    }
  }, [refreshToken])

  return (
    <div className="hc-cm6-editor-container" style={{ minHeight }}>
      <div ref={hostRef} />
    </div>
  )
})
