import { esc } from '../core/utils'
import { toolResultTone, toolStateText, toolStateTone } from '../domain/toolCallState'

// 工具块的头部由 React 渲染（标题、callid、块操作按钮同处一层），
// 这里只输出正文 HTML：状态胶囊、输入/返回内容、实时输出与权限说明。

function safePrettyJson(value: any) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch (_) {
    return String(value ?? '')
  }
}

function chip(label: unknown, tone = '') {
  const text = String(label || '').trim()
  if (!text) return ''
  const toneClass = tone ? ` fw-tool-chip-${esc(tone)}` : ''
  return `<span class="fw-tool-chip${toneClass}">${esc(text)}</span>`
}

function preBlock(label: string, text: unknown, className = '') {
  const raw = String(text ?? '')
  if (!raw.trim()) return ''
  const cls = className ? ` ${esc(className)}` : ''
  return [
    '<div class="fw-tool-field">',
    `<div class="fw-tool-field-label">${esc(label)}</div>`,
    `<pre class="fw-tool-pre${cls}">${esc(raw)}</pre>`,
    '</div>',
  ].join('')
}

function decisionLine(part: any) {
  const decision = part?.decision && typeof part.decision === 'object' ? part.decision : null
  if (!decision) return ''
  const status = String(decision?.status || '') || '未知'
  const reason = String(decision?.reason || '').trim()
  return `<div class="fw-tool-meta-line">权限：${esc(status)}${reason ? `，原因：${esc(reason)}` : ''}</div>`
}

// liveOutputBlock 渲染命令运行中的实时输出预览；仅在没有最终结果且仍在运行时出现。
function liveOutputBlock(part: any) {
  const live = part?.runtimeOutput && typeof part.runtimeOutput === 'object' ? part.runtimeOutput : null
  if (!live) return ''
  const state = String(part?.state || '').trim()
  if (state !== 'running' && state !== 'requested') return ''
  if (part?.result && typeof part.result === 'object') return ''
  const preview = String(live.preview || '').trim()
  const previewHtml = preview
    ? `<pre class="fw-tool-pre fw-tool-pre-live">${esc(preview)}</pre>`
    : ''
  return [
    '<div class="fw-tool-field">',
    '<div class="fw-tool-field-label">实时输出</div>',
    previewHtml,
    '</div>',
  ].join('')
}

export type ToolBlockHeader = {
  title: string
  glyphClass: string
  callId: string
}

// 头部元数据：标题与图标随块类型变化，callid 在结果块上回退到 result.actionId。
export function toolBlockHeader(part: any, kind: 'invocation' | 'result'): ToolBlockHeader {
  const result = part?.result && typeof part.result === 'object' ? part.result : null
  const callId = String(part?.callId || (kind === 'result' ? result?.actionId : '') || '').trim()
  if (kind === 'result') return { title: '工具返回结果', glyphClass: 'fw-tool-glyph fw-tool-glyph-result', callId }
  return { title: '工具调用', glyphClass: 'fw-tool-glyph', callId }
}

export function renderAssistantToolInvocationBodyHtml(part: any) {
  const name = String(part?.toolName || 'tool')
  const state = String(part?.state || '')
  const inputText = safePrettyJson(part?.input || {})

  return [
    '<div class="fw-tool-chip-row">',
    chip(name),
    chip(toolStateText(state, '未知状态'), toolStateTone(state)),
    '</div>',
    liveOutputBlock(part),
    preBlock('输入参数', inputText),
    decisionLine(part),
  ].join('')
}

export function renderAssistantToolResultBodyHtml(part: any) {
  const result = part?.result && typeof part.result === 'object' ? part.result : null
  if (!result) return ''
  const name = String(part?.toolName || result?.toolName || 'tool')
  const status = String(result?.status || '') || 'unknown'
  const resultText = String(result?.content || result?.error || '') || safePrettyJson(result)

  return [
    '<div class="fw-tool-chip-row">',
    chip(name),
    chip(status, toolResultTone(status)),
    '</div>',
    preBlock('返回内容', resultText),
  ].join('')
}
