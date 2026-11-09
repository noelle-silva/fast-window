import { esc } from '../core/utils'
import { toolResultTone, toolStateText, toolStateTone } from '../domain/toolCallState'

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

function callIdHtml(part: any) {
  const callId = String(part?.callId || '').trim()
  if (!callId) return ''
  return `<code class="fw-tool-call-id">${esc(callId)}</code>`
}

function toolSessionSummaryHtml(title: string, name: string, stateText = '', resultStatus = '', callId = '') {
  return [
    '<summary class="fw-tool-session-summary">',
    '<span class="fw-tool-session-mark" aria-hidden="true"></span>',
    `<span class="fw-tool-session-title">${esc(title)}</span>`,
    `<span class="fw-tool-session-name">${esc(name)}</span>`,
    stateText ? `<span class="fw-tool-session-pill">${esc(stateText)}</span>` : '',
    resultStatus ? `<span class="fw-tool-session-pill">${esc(resultStatus)}</span>` : '',
    '<span class="fw-tool-session-spacer"></span>',
    callId ? `<code class="fw-tool-call-id">${esc(callId)}</code>` : '',
    '<span class="fw-tool-session-chevron" aria-hidden="true"></span>',
    '</summary>',
  ].join('')
}

function toolSessionHtml(summaryHtml: string, bodyHtml: string) {
  return [
    '<details class="fw-tool-session" data-stop="1">',
    summaryHtml,
    '<div class="fw-tool-session-body">',
    bodyHtml,
    '</div>',
    '</details>',
  ].join('')
}

export function renderAssistantToolInvocationHtml(part: any) {
  const name = String(part?.toolName || 'tool')
  const state = String(part?.state || '')
  const inputText = safePrettyJson(part?.input || {})

  return [
    `<section class="fw-tool-block fw-tool-invocation" data-stop="1" data-tool-kind="invocation" data-tool-name="${esc(name)}" data-tool-call-id="${esc(part?.callId || '')}">`,
    '<div class="fw-tool-header">',
    '<div class="fw-tool-title"><span class="fw-tool-glyph" aria-hidden="true"></span>',
    '<span>工具调用</span></div>',
    '<div class="fw-tool-spacer"></div>',
    callIdHtml(part),
    '</div>',
    '<div class="fw-tool-chip-row">',
    chip(name),
    chip(toolStateText(state, '未知状态'), toolStateTone(state)),
    '</div>',
    liveOutputBlock(part),
    preBlock('输入参数', inputText),
    decisionLine(part),
    '</section>',
  ].join('')
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

export function renderAssistantToolResultHtml(part: any) {
  const result = part?.result && typeof part.result === 'object' ? part.result : null
  if (!result) return ''
  const name = String(part?.toolName || result?.toolName || 'tool')
  const status = String(result?.status || '') || 'unknown'
  const resultText = String(result?.content || result?.error || '') || safePrettyJson(result)

  return [
    `<section class="fw-tool-block fw-tool-result" data-stop="1" data-tool-kind="result" data-tool-name="${esc(name)}" data-tool-call-id="${esc(part?.callId || result?.actionId || '')}">`,
    '<div class="fw-tool-header">',
    '<div class="fw-tool-title"><span class="fw-tool-glyph fw-tool-glyph-result" aria-hidden="true"></span>',
    '<span>工具返回结果</span></div>',
    '<div class="fw-tool-spacer"></div>',
    callIdHtml(part),
    '</div>',
    '<div class="fw-tool-chip-row">',
    chip(name),
    chip(status, toolResultTone(status)),
    '</div>',
    preBlock('返回内容', resultText),
    '</section>',
  ].join('')
}

export function renderAssistantToolHtml(part: any) {
  const name = String(part?.toolName || 'tool')
  const result = part?.result && typeof part.result === 'object' ? part.result : null
  const resultHtml = renderAssistantToolResultHtml(part)
  const stateText = toolStateText(part?.state)
  const resultStatus = result ? String(result?.status || '').trim() : ''
  const callId = String(part?.callId || '').trim()
  return toolSessionHtml(
    toolSessionSummaryHtml(name, stateText || '工具调用', resultStatus, '', callId),
    renderAssistantToolInvocationHtml(part) + resultHtml,
  )
}
