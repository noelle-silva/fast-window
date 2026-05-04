import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Extension, Range } from '@codemirror/state'

function clamp(from: number, to: number, min: number, max: number) {
  const f = Math.max(min, Math.min(max, from))
  const t = Math.max(min, Math.min(max, to))
  return f <= t ? [f, t] as const : [t, f] as const
}

type Block = { kind: 'script' | 'style'; from: number; to: number }

function scanEmbeddedBlocks(src: string): Block[] {
  const out: Block[] = []

  const pushMatches = (kind: Block['kind'], re: RegExp) => {
    re.lastIndex = 0
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const all = String(m[0] || '')
      const body = String(m[1] || '')
      const idx = m.index
      if (idx < 0) continue
      const gt = all.indexOf('>')
      if (gt < 0) continue
      const from = idx + gt + 1
      const to = from + body.length
      if (from >= 0 && to >= from) out.push({ kind, from, to })
    }
  }

  pushMatches('script', /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)
  pushMatches('style', /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)

  return out
}

type Span = { from: number; to: number }

function isCovered(spans: Span[], at: number) {
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]
    if (at >= s.from && at < s.to) return true
  }
  return false
}

function collectSpans(text: string, patterns: RegExp[]): Span[] {
  const spans: Span[] = []
  for (const re of patterns) {
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const idx = m.index
      if (idx < 0) continue
      const raw = String(m[0] || '')
      if (!raw) continue
      spans.push({ from: idx, to: idx + raw.length })
    }
  }
  return spans
}

function highlightJavaScript(text: string, base: number, mark: (from: number, to: number, cls: string) => void) {
  const commentBlockRe = /\/\*[\s\S]*?\*\//g
  const commentLineRe = /\/\/[^\n]*/g
  const stringRe = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g

  const protectedSpans = collectSpans(text, [commentBlockRe, commentLineRe, stringRe])

  commentBlockRe.lastIndex = 0
  for (let m = commentBlockRe.exec(text); m; m = commentBlockRe.exec(text)) {
    const a = base + m.index
    const b = a + String(m[0] || '').length
    mark(a, b, 'cm-hc-js-comment')
  }
  commentLineRe.lastIndex = 0
  for (let m = commentLineRe.exec(text); m; m = commentLineRe.exec(text)) {
    const a = base + m.index
    const b = a + String(m[0] || '').length
    mark(a, b, 'cm-hc-js-comment')
  }
  stringRe.lastIndex = 0
  for (let m = stringRe.exec(text); m; m = stringRe.exec(text)) {
    const a = base + m.index
    const b = a + String(m[0] || '').length
    mark(a, b, 'cm-hc-js-string')
  }

  const keywords = [
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
    'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in',
    'instanceof', 'let', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
    'typeof', 'var', 'void', 'while', 'with', 'yield', 'async', 'await',
  ]
  const keywordRe = new RegExp(`\\b(?:${keywords.join('|')})\\b`, 'g')
  keywordRe.lastIndex = 0
  for (let m = keywordRe.exec(text); m; m = keywordRe.exec(text)) {
    if (isCovered(protectedSpans, m.index)) continue
    const raw = String(m[0] || '')
    mark(base + m.index, base + m.index + raw.length, 'cm-hc-js-keyword')
  }

  const numberRe = /\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/g
  numberRe.lastIndex = 0
  for (let m = numberRe.exec(text); m; m = numberRe.exec(text)) {
    if (isCovered(protectedSpans, m.index)) continue
    const raw = String(m[0] || '')
    mark(base + m.index, base + m.index + raw.length, 'cm-hc-js-number')
  }

  const builtinRe = /\b(?:console|document|window|Math|JSON|Promise|Array|Object|String|Number|Boolean|Date|RegExp|Map|Set|WeakMap|WeakSet|Error)\b/g
  builtinRe.lastIndex = 0
  for (let m = builtinRe.exec(text); m; m = builtinRe.exec(text)) {
    if (isCovered(protectedSpans, m.index)) continue
    const raw = String(m[0] || '')
    mark(base + m.index, base + m.index + raw.length, 'cm-hc-js-builtin')
  }

  // function foo(
  const fnDeclRe = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
  fnDeclRe.lastIndex = 0
  for (let m = fnDeclRe.exec(text); m; m = fnDeclRe.exec(text)) {
    const idx = m.index
    if (idx < 0) continue
    const name = String(m[1] || '')
    if (!name) continue
    const nameAt = String(m[0] || '').indexOf(name)
    if (nameAt < 0) continue
    if (isCovered(protectedSpans, idx + nameAt)) continue
    mark(base + idx + nameAt, base + idx + nameAt + name.length, 'cm-hc-js-fn')
  }
}

function highlightCss(text: string, base: number, mark: (from: number, to: number, cls: string) => void) {
  const commentRe = /\/\*[\s\S]*?\*\//g
  const stringRe = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
  const protectedSpans = collectSpans(text, [commentRe, stringRe])

  commentRe.lastIndex = 0
  for (let m = commentRe.exec(text); m; m = commentRe.exec(text)) {
    const a = base + m.index
    const b = a + String(m[0] || '').length
    mark(a, b, 'cm-hc-css-comment')
  }
  stringRe.lastIndex = 0
  for (let m = stringRe.exec(text); m; m = stringRe.exec(text)) {
    const a = base + m.index
    const b = a + String(m[0] || '').length
    mark(a, b, 'cm-hc-css-string')
  }

  const atRuleRe = /@[\w-]+/g
  atRuleRe.lastIndex = 0
  for (let m = atRuleRe.exec(text); m; m = atRuleRe.exec(text)) {
    if (isCovered(protectedSpans, m.index)) continue
    const raw = String(m[0] || '')
    mark(base + m.index, base + m.index + raw.length, 'cm-hc-css-atrule')
  }

  // property:
  const propRe = /\b([A-Za-z-]{2,})\s*:/g
  propRe.lastIndex = 0
  for (let m = propRe.exec(text); m; m = propRe.exec(text)) {
    const idx = m.index
    if (idx < 0) continue
    const name = String(m[1] || '')
    if (!name) continue
    const nameAt = String(m[0] || '').indexOf(name)
    if (nameAt < 0) continue
    if (isCovered(protectedSpans, idx + nameAt)) continue
    mark(base + idx + nameAt, base + idx + nameAt + name.length, 'cm-hc-css-prop')
  }

  const valueRe = /#(?:[0-9a-fA-F]{3,8})\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b/g
  valueRe.lastIndex = 0
  for (let m = valueRe.exec(text); m; m = valueRe.exec(text)) {
    if (isCovered(protectedSpans, m.index)) continue
    const raw = String(m[0] || '')
    mark(base + m.index, base + m.index + raw.length, 'cm-hc-css-value')
  }
}

export function htmlHighlightExtension(): Extension {
  const commentRe = /<!--[\s\S]*?-->/g
  const tagStartRe = /<\/?[A-Za-z][A-Za-z0-9:-]*/g
  const stringRe = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g
  const tagChunkRe = /<[^>]*>/g
  const attrNameRe = /\b([A-Za-z_:][A-Za-z0-9:._-]*)(?=\s*=)/g
  const entityRe = /&(?:[A-Za-z][A-Za-z0-9]+|#[0-9]+|#x[0-9A-Fa-f]+);/g

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = this.build(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view)
        }
      }

      private build(view: EditorView): DecorationSet {
        const doc = view.state.doc
        const decos: Range<Decoration>[] = []

        const mark = (from: number, to: number, cls: string) => {
          const [f, t] = clamp(from, to, 0, doc.length)
          if (f < t) decos.push(Decoration.mark({ class: cls }).range(f, t))
        }

        // 嵌入块：script/style 里的 JS/CSS，上色“函数/关键字”等
        const full = doc.toString()
        if (full.length <= 200_000) {
          const blocks = scanEmbeddedBlocks(full)
          for (const b of blocks) {
            // 只处理可见范围附近，避免无谓扫描
            for (const vr of view.visibleRanges) {
              const overlapFrom = Math.max(vr.from, b.from)
              const overlapTo = Math.min(vr.to, b.to)
              if (overlapFrom >= overlapTo) continue
              const slice = doc.sliceString(overlapFrom, overlapTo)
              if (b.kind === 'script') highlightJavaScript(slice, overlapFrom, mark)
              else highlightCss(slice, overlapFrom, mark)
            }
          }
        }

        for (const vr of view.visibleRanges) {
          const from = vr.from
          const to = vr.to
          const text = doc.sliceString(from, to)

          commentRe.lastIndex = 0
          for (let m = commentRe.exec(text); m; m = commentRe.exec(text)) {
            const a = from + m.index
            const b = a + (m[0]?.length ?? 0)
            mark(a, b, 'cm-hc-html-comment')
          }

          stringRe.lastIndex = 0
          for (let m = stringRe.exec(text); m; m = stringRe.exec(text)) {
            const a = from + m.index
            const b = a + (m[0]?.length ?? 0)
            mark(a, b, 'cm-hc-html-string')
          }

          entityRe.lastIndex = 0
          for (let m = entityRe.exec(text); m; m = entityRe.exec(text)) {
            const a = from + m.index
            const b = a + (m[0]?.length ?? 0)
            mark(a, b, 'cm-hc-html-entity')
          }

          tagStartRe.lastIndex = 0
          for (let m = tagStartRe.exec(text); m; m = tagStartRe.exec(text)) {
            const raw = String(m[0] || '')
            const at = m.index
            if (at < 0) continue
            const prefixLen = raw.startsWith('</') ? 2 : 1
            const a = from + at
            mark(a, a + prefixLen, 'cm-hc-html-bracket')
            mark(a + prefixLen, a + raw.length, 'cm-hc-html-tag')
          }

          tagChunkRe.lastIndex = 0
          for (let m = tagChunkRe.exec(text); m; m = tagChunkRe.exec(text)) {
            const raw = String(m[0] || '')
            const at = m.index
            if (at < 0) continue
            if (raw.startsWith('<!--')) continue

            const tagAbsFrom = from + at
            const tagAbsTo = tagAbsFrom + raw.length

            // <   >
            mark(tagAbsFrom, tagAbsFrom + 1, 'cm-hc-html-bracket')
            mark(tagAbsTo - 1, tagAbsTo, 'cm-hc-html-bracket')
            // </...  / ...>   />
            if (raw.startsWith('</')) mark(tagAbsFrom + 1, tagAbsFrom + 2, 'cm-hc-html-bracket')
            if (raw.endsWith('/>')) mark(tagAbsTo - 2, tagAbsTo - 1, 'cm-hc-html-bracket')

            // <!DOCTYPE ...>
            if (/^<!doctype\b/i.test(raw)) {
              mark(tagAbsFrom + 1, Math.min(tagAbsFrom + 9, tagAbsTo - 1), 'cm-hc-html-doctype')
            }

            // attr names with '='
            attrNameRe.lastIndex = 0
            for (let am = attrNameRe.exec(raw); am; am = attrNameRe.exec(raw)) {
              const name = String(am[1] || '')
              if (!name) continue
              const nameAt = am.index
              const a = tagAbsFrom + nameAt
              mark(a, a + name.length, 'cm-hc-html-attr')
            }

            // '=' and unquoted values
            for (let i = 0; i < raw.length; i++) {
              if (raw[i] !== '=') continue
              const eqAbs = tagAbsFrom + i
              mark(eqAbs, eqAbs + 1, 'cm-hc-html-operator')

              let j = i + 1
              while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++
              if (j >= raw.length) continue
              const ch = raw[j]
              if (ch === '"' || ch === '\'') continue // 已由 stringRe 着色
              if (ch === '>' || ch === '/' || ch === '<') continue

              let k = j
              while (k < raw.length) {
                const c = raw[k]
                if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '>' || c === '/') break
                k++
              }
              if (k > j) {
                mark(tagAbsFrom + j, tagAbsFrom + k, 'cm-hc-html-value')
              }
            }
          }
        }

        return Decoration.set(decos, true)
      }
    },
    {
      decorations: v => v.decorations,
    },
  )
}
