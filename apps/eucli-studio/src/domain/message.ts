import { uid, clamp } from '../core/utils'
import { CHAT_ATTACHMENT_KINDS, CHAT_MSG_GROUP_ROLES } from './constants'

export function normalizeMessageAttachments(input: any) {
  const list = Array.isArray(input) ? input : []
  const out = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const id = String((raw as any).id || uid('att'))
    const name = String((raw as any).name || '文件')
    const kind0 = String((raw as any).kind || 'txt')
    const kind = CHAT_ATTACHMENT_KINDS.has(kind0) ? kind0 : 'txt'
    const lang0 = String((raw as any).lang || '')
    const lang = lang0 || (kind === 'md' ? 'markdown' : 'text')
    const text = String((raw as any).text || '')
    const fullLen = clamp(Number((raw as any).fullLen || text.length || 0), 0, 10_000_000)
    const sendLen = clamp(Number((raw as any).sendLen || text.length || 0), 0, fullLen || 0)
    const sendPct = clamp(Number((raw as any).sendPct ?? 100), 0, 100)
    out.push({ id, name, kind, lang, text, fullLen, sendLen, sendPct })
    if (out.length >= 20) break
  }
  return out
}

export function normalizeMessageGroup(m: any) {
  const g = m && typeof m === 'object' ? m : null
  const groupId = String(g?.groupId || '').trim()
  const groupRole0 = String(g?.groupRole || '').trim()
  const groupRole = CHAT_MSG_GROUP_ROLES.has(groupRole0) ? groupRole0 : ''
  const groupParentMid = String(g?.groupParentMid || '').trim()
  if (!groupId || !groupRole) return { groupId: '', groupRole: '', groupParentMid: '' }
  if (groupRole === 'attachment' && !groupParentMid) return { groupId: '', groupRole: '', groupParentMid: '' }
  return { groupId, groupRole, groupParentMid }
}
