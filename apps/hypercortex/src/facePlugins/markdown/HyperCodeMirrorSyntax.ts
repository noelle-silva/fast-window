import { StateEffect, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import {
  scanLiveBlocks,
  selectionIntersects,
  findInlineCodeRanges,
  findInlineMathRanges,
  findNoteRefRanges,
  type NoteIndexMap,
} from './HyperCodeMirrorScanner'
import { BulletWidget, InlineMathWidget, InlineNoteRefWidget } from './HyperCodeMirrorWidgets'
import { globalWriteClipboardText, globalShowToast } from './HyperCodeMirrorEditor'

export const refreshEffect = StateEffect.define<number>()

export function syntaxHighlightExtension(opts: { getNoteIndexMap: () => NoteIndexMap | null }) {
  return ViewPlugin.fromClass(
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
        const noteIndexMap = opts.getNoteIndexMap()

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
}
