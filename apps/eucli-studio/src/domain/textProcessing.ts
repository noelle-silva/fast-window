import { clamp } from '../core/utils'
import { normalizeMessageAttachments } from './message'

export function limitHistory(messages: any, maxTurns: number) {
  const list = Array.isArray(messages) ? messages : []
  const ua = list.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant'))
  return ua.slice(Math.max(0, ua.length - maxTurns))
}

export function looksLikeImageDataUrl(s: any) {
  const t = String(s || '')
  return t.startsWith('data:image/')
}

export function escapeFence(s: string) {
  return String(s || '').replaceAll('```', '``\u200b`')
}

export function buildUserTextForOpenAi(m: any) {
  let base = String(m?.content || '').trim()
  const atts = normalizeMessageAttachments(m?.attachments)
  if (!atts.length) return base

  if (atts.length === 1) {
    const n = String(atts[0]?.name || '')
    const defaultLabel = n ? `附件：${n}` : ''
    if (defaultLabel && base === defaultLabel) base = ''
  }

  const blocks: string[] = []
  for (const a of atts) {
    const name = String(a?.name || '文件')
    const fullLen = clamp(Number(a?.fullLen || 0), 0, 10_000_000)
    const sendLen = clamp(Number(a?.sendLen || 0), 0, fullLen || 0)
    const pct = clamp(Number(a?.sendPct ?? 100), 0, 100)
    const lang = String(a?.lang || (String(a?.kind || '') === 'md' ? 'markdown' : 'text')) || 'text'
    const raw = String(a?.text || '').trim()
    if (!raw) continue
    const snippet = escapeFence(raw)
    const header = `附件：${name}（发送 ${pct}%：${sendLen}/${fullLen} 字符）`
    blocks.push(`${header}\n\`\`\`${lang}\n${snippet}\n\`\`\``)
    if (blocks.length >= 20) break
  }

  const extra = blocks.join('\n\n').trim()
  if (!extra) return base
  return base ? `${base}\n\n${extra}`.trim() : extra
}

export function extractMermaidCodeFromAiReply(input: any) {
  const text = String(input || '')
  const re = /```([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)```/g
  const blocks: { lang: string; code: string }[] = []
  for (;;) {
    const m = re.exec(text)
    if (!m) break
    blocks.push({ lang: String(m[1] || '').trim().toLowerCase(), code: String(m[2] || '') })
    if (blocks.length >= 10) break
  }

  const prefer = blocks.find((b) => b.lang === 'mermaid' || b.lang === 'flowchart' || b.lang === 'graph')
  const first = prefer || blocks[0] || null
  if (first) return String(first.code || '').trim()

  return text.trim()
}

export function tokenizeFencesForReplace(input: any) {
  const src = String(input || '')
  const lines = src.split('\n')

  const out: { kind: string; [key: string]: any }[] = []
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
      const closeLineRaw = withNl
      const raw = `${openLineRaw}${content}${closeLineRaw}`
      const lang = fenceInfo.split(/\s+/g)[0] || ''
      out.push({ kind: 'fence', raw, lang, content, openLineRaw, closeLineRaw, closed: true })
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
    out.push({ kind: 'fence', raw, lang, content, openLineRaw, closeLineRaw: '', closed: false })
    inFence = false
  }

  flushText()
  return out
}

export function replaceMermaidFenceOnce(markdown: any, oldCode: any, newCode: any) {
  const src = String(markdown || '').replace(/\r\n/g, '\n')
  const oldTrim = String(oldCode || '').trim()
  const nextTrim = String(newCode || '').trim()
  if (!oldTrim || !nextTrim) return { text: String(markdown || ''), replaced: false }

  const tokens = tokenizeFencesForReplace(src)
  const out: string[] = []
  let replaced = false

  for (const t of tokens) {
    if (t?.kind !== 'fence') {
      out.push(String(t?.text || ''))
      continue
    }

    const lang = String(t.lang || '').trim().toLowerCase()
    const isMermaid = !!t.closed && (lang === 'mermaid' || lang === 'flowchart' || lang === 'graph')
    const same = String(t.content || '').trim() === oldTrim

    if (!replaced && isMermaid && same) {
      const content = nextTrim + '\n'
      out.push(String(t.openLineRaw || '') + content + String(t.closeLineRaw || ''))
      replaced = true
      continue
    }

    out.push(String(t.raw || ''))
  }

  return { text: out.join(''), replaced }
}

export function normalizeAiGeneratedChatTitle(input: any) {
  let s = String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+\n/g, '\n')
    .trim()

  const lines = s.split('\n').map((x) => String(x || '').trim()).filter((x) => !!x)
  s = String(lines[0] || '').trim()

  s = s.replace(/^(标题|会话标题|建议标题)\s*[:：]\s*/i, '').trim()
  s = s.replace(/^["'""'']+|["'""'']+$/g, '').trim()

  s = s.replace(/\s+/g, ' ').trim()
  if (s.length > 80) s = s.slice(0, 80).trim()
  return s
}

export function normalizeAiGeneratedStickerName(input: any) {
  let s = String(input || '')
    .replace(/\r\n/g, '\n')
    .trim()

  const lines = s.split('\n').map((x) => String(x || '').trim()).filter((x) => !!x)
  s = String(lines[0] || '').trim()

  s = s.replace(/^(名称|表情名|建议名称|建议表情名)\s*[:：]\s*/i, '').trim()
  s = s.replace(/^["'""'']+|["'""'']+$/g, '').trim()
  s = s.replace(/[\/\\\]\r\n]/g, '_').trim()
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length > 80) s = s.slice(0, 80).trim()
  return s
}

export function buildChatTranscriptForTitle(chat: any, maxTurns = 24) {
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  const his = limitHistory(msgs, clamp(Math.round(Number(maxTurns || 0)), 2, 60))
  const parts: string[] = []

  for (const m of his) {
    if (!m || typeof m !== 'object') continue
    const role = m.role === 'assistant' ? '助手' : '用户'
    let content = String(m.content || '').trim()
    if (!content) continue
    if (content.length > 1800) content = `${content.slice(0, 1800).trim()}…`
    parts.push(`${role}：${content}`)
    if (parts.length >= 80) break
  }

  const transcript = parts.join('\n\n').trim()
  if (!transcript) return ''
  const userContent = `请为以下聊天记录生成一个简短标题：\n\n${transcript}`
  return userContent.length > 16000 ? userContent.slice(Math.max(0, userContent.length - 16000)).trim() : userContent
}
