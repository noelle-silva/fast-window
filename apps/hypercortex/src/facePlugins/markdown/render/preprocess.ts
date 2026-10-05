import { parseNotePlaceholderBody } from '../../../notePlaceholder'
import { pickAssetDisplayName } from '../../../assetDisplayName'

/* ------------------------------------------------------------------ */
/*  HTML 缩进预处理                                                     */
/* ------------------------------------------------------------------ */

export function preprocessHtmlIndentation(source: unknown) {
  function dedentHtmlLines(s: unknown) {
    const t = String(s || '')
    return t.replace(/^([ \t]+)(?=<|<!--)/gm, (_m, ws) => {
      const w = String(ws || '')
      let cols = 0
      for (let i = 0; i < w.length; i++) {
        cols += w[i] === '\t' ? 4 - (cols % 4) : 1
      }
      if (cols < 4) return w
      return ' '.repeat(cols % 4)
    })
  }

  const src = String(source || '').replace(/\r\n/g, '\n')
  const tokens = tokenizeFences(src)
  return tokens
    .map((t) => {
      if (t.kind === 'text') return dedentHtmlLines(t.text)
      return t.raw
    })
    .join('')
}

/* ================================================================== */
/*  顶层辅助函数（不依赖闭包状态）                                        */
/* ================================================================== */

type PreprocessedMath = { tex: string; display: boolean }
type PreprocessedAsset = { ref: string; name: string; width?: number; nameIsDefault?: boolean }
type PreprocessedNoteRef = { noteId: string; faceId?: string; displayText: string; remarks: string }

type FenceToken =
  | { kind: 'text'; text: string }
  | { kind: 'fence'; raw: string; lang: string; content: string; closed: boolean }

export function preprocessContent(
  source: unknown,
): { text: string; math: PreprocessedMath[]; mermaid: string[]; assets: PreprocessedAsset[]; noteRefs: PreprocessedNoteRef[] } {
  const src = String(source || '').replace(/\r\n/g, '\n')
  const tokens = tokenizeFences(src)

  const mermaid: string[] = []
  const math: PreprocessedMath[] = []
  const assets: PreprocessedAsset[] = []
  const noteRefs: PreprocessedNoteRef[] = []
  const out: string[] = []
  const withAssets = (input: string) => replaceAssetsOutsideInlineCode(input, assets)

  for (const t of tokens) {
    if (t.kind === 'fence') {
      const lang = String(t.lang || '').trim().toLowerCase()
      const isMermaid = t.closed && (lang === 'mermaid' || lang === 'flowchart' || lang === 'graph')
      if (isMermaid) {
        const id = mermaid.length
        mermaid.push(String(t.content || '').trim())
        out.push(`@@MERMAID_${id}@@`)
      } else {
        out.push(t.raw)
      }
      continue
    }

    const withNoteRefs = replaceNoteRefsOutsideInlineCode(withAssets(t.text), noteRefs)
    const withMath = replaceMathOutsideInlineCode(withNoteRefs, math)
    out.push(withMath)
  }

  return { text: out.join(''), math, mermaid, assets, noteRefs }
}

function replaceAssetsOutsideInlineCode(input: string, acc: PreprocessedAsset[]) {
  const parts = splitInlineCodeSpans(input)
  return parts
    .map((p) => {
      if (p.kind === 'code') return p.value
      return replaceAssetsInPlainText(p.value, acc)
    })
    .join('')
}

function replaceAssetsInPlainText(input: string, acc: PreprocessedAsset[]) {
  // 支持两种语法：
  // 1) {{asset:ref}} / {{asset:ref|displayName|width}}
  // 2) {{asset:ref||width}}（UI 当前默认生成这种“只带宽度”的格式）
  const assetPattern = /\{\{asset:([^\}\n]+?)\}\}/g
  return String(input || '').replace(assetPattern, (_m, bodyRaw) => {
    const body = String(bodyRaw || '').trim()
    if (!body) return ''

    let refText = body
    let displayName = ''
    let widthStr = ''

    const dbl = body.indexOf('||')
    if (dbl >= 0) {
      refText = body.slice(0, dbl).trim()
      widthStr = body.slice(dbl + 2).trim()
    } else {
      const parts = body.split('|')
      refText = String(parts[0] || '').trim()
      displayName = String(parts[1] || '').trim()
      widthStr = String(parts[2] || '').trim()
    }

    const ref = String(refText || '').trim()
    if (!ref) return ''
    const dotIdx = ref.lastIndexOf('.')
    const ext = dotIdx > 0 ? ref.slice(dotIdx + 1).toLowerCase() : ''
    const name0 = String(displayName || '').trim()
    const nameIsDefault = !name0
    const name = pickAssetDisplayName({ explicitName: name0, ext })
    const widthNum = widthStr ? Number(widthStr) : NaN
    const width = Number.isFinite(widthNum) && widthNum > 0 ? widthNum : undefined
    const id = acc.length
    acc.push({ ref, name, width, nameIsDefault })
    return `@@ASSET_${id}@@`
  })
}

function tokenizeFences(input: string): FenceToken[] {
  const src = String(input || '')
  const lines = src.split('\n')

  const out: FenceToken[] = []
  const textBuf: string[] = []

  const flushText = () => {
    if (!textBuf.length) return
    out.push({ kind: 'text', text: textBuf.join('') })
    textBuf.length = 0
  }

  let inFence = false
  let fenceMarker = ''
  let fenceInfo = ''
  let openLineRaw = ''
  const fenceLinesRaw: string[] = []

  const openRe = /^(\s*)(`{3,})(.*)$/
  const closeRe = /^(\s*)(`{3,})\s*$/
  let fenceIndent = ''

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const withNl = idx < lines.length - 1 ? line + '\n' : line
    if (!inFence) {
      const m = openRe.exec(line)
      if (!m) { textBuf.push(withNl); continue }

      flushText()
      inFence = true
      fenceIndent = String(m[1] || '')
      fenceMarker = String(m[2] || '```')
      fenceInfo = String(m[3] || '').trim()
      openLineRaw = withNl
      fenceLinesRaw.length = 0
      continue
    }

    const m2 = closeRe.exec(line)
    if (m2 && String(m2[1] || '') === fenceIndent && String(m2[2] || '') === fenceMarker) {
      const content = fenceLinesRaw.join('')
      const raw = `${openLineRaw}${content}${withNl}`
      const lang = fenceInfo.split(/\s+/g)[0] || ''
      out.push({ kind: 'fence', raw, lang, content, closed: true })
      inFence = false
      fenceMarker = ''
      fenceIndent = ''
      fenceInfo = ''
      openLineRaw = ''
      fenceLinesRaw.length = 0
      continue
    }

    fenceLinesRaw.push(withNl)
  }

  if (inFence) {
    const content = fenceLinesRaw.join('')
    const raw = openLineRaw + content
    const lang = fenceInfo.split(/\s+/g)[0] || ''
    out.push({ kind: 'fence', raw, lang, content, closed: false })
  }

  flushText()
  return out
}

function splitInlineCodeSpans(input: string): Array<{ kind: 'text' | 'code'; value: string }> {
  const s = String(input || '')
  const out: Array<{ kind: 'text' | 'code'; value: string }> = []
  let i = 0
  let last = 0

  while (i < s.length) {
    if (s[i] !== '`') { i++; continue }

    let n = 1
    while (i + n < s.length && s[i + n] === '`') n++
    const marker = '`'.repeat(n)
    const start = i
    const end = s.indexOf(marker, i + n)
    if (end < 0) break

    if (start > last) out.push({ kind: 'text', value: s.slice(last, start) })
    out.push({ kind: 'code', value: s.slice(start, end + n) })
    i = end + n
    last = i
  }

  if (last < s.length) out.push({ kind: 'text', value: s.slice(last) })
  return out
}

function replaceMathOutsideInlineCode(input: string, acc: PreprocessedMath[]) {
  const parts = splitInlineCodeSpans(input)
  return parts
    .map((p) => {
      if (p.kind === 'code') return p.value
      return replaceMathInPlainText(p.value, acc)
    })
    .join('')
}

function replaceNoteRefsOutsideInlineCode(input: string, acc: PreprocessedNoteRef[]) {
  const notePlaceholderPattern = /\[\[([^\]\n]+?)\]\]/g
  const parts = splitInlineCodeSpans(input)
  return parts
    .map((p) => {
      if (p.kind === 'code') return p.value
      return p.value.replace(notePlaceholderPattern, (m, innerRaw) => {
        const inner = String(innerRaw || '').trim()
        const parsed = parseNotePlaceholderBody(inner)
        if (!parsed?.noteId) return m
        const noteId = String(parsed.noteId || '').trim()
        if (!noteId) return m
        const displayText = String(parsed.title || '').trim()
        const remarks = String(parsed.remarks || '').trim()
        const faceId = String(parsed.face || '').trim() || undefined
        const id = acc.length
        acc.push({ noteId, faceId, displayText, remarks })
        return `@@NOTE_REF_${id}@@`
      })
    })
    .join('')
}

function replaceMathInPlainText(input: string, acc: PreprocessedMath[]) {
  let s = String(input || '')

  const stash = (tex: string, display: boolean) => {
    const id = acc.length
    acc.push({ tex: String(tex || ''), display })
    return `@@MATH_${display ? 'BLOCK' : 'INLINE'}_${id}@@`
  }

  // display: $$...$$
  s = s.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_m, tex) => stash(String(tex || '').trim(), true))
  // display: \[...\]
  s = s.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_m, tex) => stash(String(tex || '').trim(), true))
  // inline: \( ... \)
  s = s.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_m, tex) => stash(String(tex || '').trim(), false))
  // inline: $...$（防误判：必须像"公式"）
  s = s.replace(/\$([^\$\n]+?)\$/g, (m, tex) => {
    const t = String(tex || '').trim()
    if (!t) return m
    if (!/[A-Za-z\\]|[_^]/.test(t)) return m
    return stash(t, false)
  })

  return s
}
