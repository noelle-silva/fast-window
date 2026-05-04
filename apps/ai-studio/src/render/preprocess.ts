import { parseToolRequestCalls } from '@noelle-silva/eucli-aitoolcall-sdk'
import { parseStickerSize } from './stickers'

type PreprocessedMath = { tex: string; display: boolean }
type PreprocessedSticker = { raw: string; category: string; name: string; size?: number }
type PreprocessedToolRequest = {
  ok: boolean
  toolNames: string[]
  detailText: string
}

export type FenceToken =
  | { kind: 'text'; text: string }
  | { kind: 'fence'; raw: string; lang: string; content: string; closed: boolean }

export function preprocessAssistantContent(
  source: unknown,
  options?: { stickersEnabled?: boolean },
): { text: string; math: PreprocessedMath[]; mermaid: string[]; stickers: PreprocessedSticker[]; toolRequests: PreprocessedToolRequest[] } {
  const src = String(source || '').replace(/\r\n/g, '\n')
  const tokens = tokenizeFences(src)

  const mermaid: string[] = []
  const math: PreprocessedMath[] = []
  const stickers: PreprocessedSticker[] = []
  const toolRequests: PreprocessedToolRequest[] = []
  const out: string[] = []
  const stickersEnabled = !!options?.stickersEnabled

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

    // 先把 TOOL_REQUEST 整块摘出来做占位符保护，避免后续的数学/贴纸预处理改写块内内容导致解析失败。
    const withTools = replaceToolRequestsOutsideInlineCode(t.text, toolRequests)
    const withMath = replaceMathOutsideInlineCode(withTools, math)
    out.push(stickersEnabled ? replaceStickersOutsideInlineCode(withMath, stickers) : withMath)
  }

  return { text: out.join(''), math, mermaid, stickers, toolRequests }
}

export function tokenizeFences(input: string): FenceToken[] {
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
      if (!m) {
        textBuf.push(withNl)
        continue
      }

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
    inFence = false
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
    if (s[i] !== '`') {
      i++
      continue
    }

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

function replaceStickersOutsideInlineCode(input: string, acc: PreprocessedSticker[]) {
  const parts = splitInlineCodeSpans(input)
  return parts
    .map((p) => {
      if (p.kind === 'code') return p.value
      return replaceStickersInPlainText(p.value, acc)
    })
    .join('')
}

function replaceToolRequestsOutsideInlineCode(input: string, acc: PreprocessedToolRequest[]) {
  const parts = splitInlineCodeSpans(input)
  return parts
    .map((p) => {
      if (p.kind === 'code') return p.value
      return replaceToolRequestsInPlainText(p.value, acc)
    })
    .join('')
}

function replaceToolRequestsInPlainText(input: string, acc: PreprocessedToolRequest[]) {
  const s = String(input || '')
  if (!s) return s

  const OPEN = '<<<[TOOL_REQUEST]>>>'
  const CLOSE = '<<<[END_TOOL_REQUEST]>>>'

  let out = ''
  let i = 0
  while (i < s.length) {
    const openIdx = s.indexOf(OPEN, i)
    if (openIdx < 0) {
      out += s.slice(i)
      break
    }

    const closeIdx = s.indexOf(CLOSE, openIdx + OPEN.length)
    if (closeIdx < 0) {
      // 未闭合的块不要动，避免“半截工具块”破坏正常渲染。
      out += s.slice(i)
      break
    }

    const endIdx = closeIdx + CLOSE.length
    out += s.slice(i, openIdx)

    const rawBlock = s.slice(openIdx, endIdx)
    const parsed = parseToolRequestCalls(rawBlock as any)

    if ((parsed as any)?.ok) {
      const calls = Array.isArray((parsed as any)?.calls) ? (parsed as any).calls : []
      const toolNames = calls.map((c: any) => String(c?.tool_name || '').trim()).filter(Boolean)
      const lines: string[] = []
      for (const c of calls) {
        const idx = Number(c?.index || 0) || 0
        lines.push(`CALL-${idx || ''}`.trim())
        lines.push(`tool_name: ${String(c?.tool_name || '').trim()}`)
        if (c?.agent) lines.push(`agent: ${String(c.agent).trim()}`)
        if (c?.schedule) lines.push(`schedule: ${String(c.schedule).trim()}`)
        if (c?.note) lines.push(`note: ${String(c.note).trim()}`)
        const params = c?.parameters && typeof c.parameters === 'object' ? c.parameters : {}
        const keys = Object.keys(params).sort()
        if (keys.length) {
          lines.push('parameters:')
          for (const k of keys) lines.push(`  ${k}: ${String((params as any)[k] ?? '')}`)
        }
        lines.push('')
      }

      const id = acc.length
      acc.push({
        ok: true,
        toolNames,
        detailText: lines.join('\n').trim(),
      })
      out += `@@TOOL_REQUEST_${id}@@`
    } else {
      const id = acc.length
      acc.push({
        ok: false,
        toolNames: [],
        detailText: rawBlock,
      })
      out += `@@TOOL_REQUEST_${id}@@`
    }

    i = endIdx
  }

  return out
}

function replaceStickersInPlainText(input: string, acc: PreprocessedSticker[]) {
  const s = String(input || '')
  if (!s) return s

  const re = /\[\[\s*(?:sticker|表情包)\s*:\s*([^\]\n]{1,220}?)\s*\]\]/g
  return s.replace(re, (m, innerRaw) => {
    const inner = String(innerRaw || '').trim()
    if (!inner) return m

    const p = inner.replace(/\\/g, '/')
    if (!p || p.includes('..') || p.includes('://') || p.includes('\u0000')) return m

    const parts = p
      .split('/')
      .map((x) => String(x || '').trim())
      .filter((x) => !!x)
    if (parts.length !== 2 && parts.length !== 3) return m

    const category = parts[0]
    const name = parts[1]
    if (!category || !name) return m
    if (category.includes(']') || name.includes(']')) return m

    let size: number | undefined = undefined
    if (parts.length === 3) {
      const n = parseStickerSize(parts[2])
      if (!n) return m
      size = n
    }

    const id = acc.length
    acc.push({ raw: m, category, name, size })
    return `@@STICKER_${id}@@`
  })
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

  // inline: $...$（做一点防误判：必须像“公式”）
  s = s.replace(/\$([^\$\n]+?)\$/g, (m, tex) => {
    const t = String(tex || '').trim()
    if (!t) return m
    if (!/[A-Za-z\\]|[_^]/.test(t)) return m
    return stash(t, false)
  })

  return s
}

