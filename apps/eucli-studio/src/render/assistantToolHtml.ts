import { esc } from '../core/utils'

// 工具块的头部由 React 渲染（标题、状态、工具名 / callid、块操作按钮同处一层），
// 这里只输出正文 HTML：输入/返回内容、实时输出与权限说明。

function safePrettyJson(value: any) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch (_) {
    return String(value ?? '')
  }
}

// 正文只给内容，不再带「输入参数 / 返回内容」这类标签：块标题已经说明了这是什么。
function preBlock(text: unknown, className = '') {
  const raw = String(text ?? '')
  if (!raw.trim()) return ''
  const cls = className ? ` ${esc(className)}` : ''
  return `<div class="fw-tool-field"><pre class="fw-tool-pre${cls}">${esc(raw)}</pre></div>`
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
  const previewHtml = preview ? `<pre class="fw-tool-pre fw-tool-pre-live">${esc(preview)}</pre>` : ''
  return `<div class="fw-tool-field"><div class="fw-tool-field-label">实时输出</div>${previewHtml}</div>`
}

// callid 在结果块上回退到 result.actionId。
export function toolBlockCallId(part: any, kind: 'invocation' | 'result'): string {
  const result = part?.result && typeof part.result === 'object' ? part.result : null
  return String(part?.callId || (kind === 'result' ? result?.actionId : '') || '').trim()
}

export function renderAssistantToolInvocationBodyHtml(part: any) {
  const inputText = safePrettyJson(part?.input || {})
  return [liveOutputBlock(part), preBlock(inputText), decisionLine(part)].join('')
}

export function renderAssistantToolResultBodyHtml(part: any) {
  const result = part?.result && typeof part.result === 'object' ? part.result : null
  if (!result) return ''
  const resultText = String(result?.content || result?.error || '') || safePrettyJson(result)
  return preBlock(resultText)
}
