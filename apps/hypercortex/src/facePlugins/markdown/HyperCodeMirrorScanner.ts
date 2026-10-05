import type { Text } from '@codemirror/state'
import { parseNotePlaceholderBody } from '../../notePlaceholder'

export type LiveBlockKind = 'latex' | 'mermaid' | 'code' | 'table'
export type LiveBlock = { from: number; to: number; focusTo: number; kind: LiveBlockKind; source: string }
export type AssetPlaceholder = { from: number; to: number; line: number; inline: boolean; source: string; ext: string }

export function sliceLineEndWithBreak(doc: Text, line: { to: number; number: number }) {
  // Text 以 '\n' 作为换行，line.to 不包含换行符
  return line.number < doc.lines ? line.to + 1 : line.to
}

export function scanLiveBlocks(doc: Text): LiveBlock[] {
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
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'])

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

export function scanAssetPlaceholders(doc: Text): AssetPlaceholder[] {
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

export function selectionIntersects(sel: { from: number; to: number; head: number }, block: { from: number; focusTo: number }) {
  // 光标（空选区）：边界也算”进入块内”，这样点击预览会立刻展开源码
  if (sel.from === sel.to) return sel.head >= block.from && sel.head <= block.focusTo
  // 选区：只要有交集就视为”在块内”
  return sel.from <= block.focusTo && sel.to >= block.from
}

export type NoteIndexMap = Record<string, { title: string }>
export type NoteRefRange = { from: number; to: number; noteId: string; title: string; remarks: string }

const NOTE_REF_PATTERN = /\[\[([^\]\n]+?)\]\]/g

export function findNoteRefRanges(lineText: string, codeRanges: Array<[number, number]>): NoteRefRange[] {
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

export function findInlineMathRanges(lineText: string, codeRanges: Array<[number, number]>) {
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

export function findInlineCodeRanges(lineText: string) {
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
