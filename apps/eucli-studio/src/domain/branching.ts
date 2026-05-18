import { now, uid } from '../core/utils'
import { CHAT_BRANCHING_SCHEMA_VERSION, CHAT_DEFAULT_BRANCH_ID, CHAT_DEFAULT_BRANCH_NAME } from './constants'

export function normalizeBranchId(input: any) {
  let s = String(input || '').trim()
  if (!s) return CHAT_DEFAULT_BRANCH_ID
  if (s.length > 60) s = s.slice(0, 60).trim()
  s = s.replace(/[^a-zA-Z0-9._-]/g, '_')
  return s || CHAT_DEFAULT_BRANCH_ID
}

export function normalizeBranchName(input: any) {
  let s = String(input || '').replace(/\s+/g, ' ').trim()
  if (!s) return CHAT_DEFAULT_BRANCH_NAME
  if (s.length > 60) s = s.slice(0, 60).trim()
  return s || CHAT_DEFAULT_BRANCH_NAME
}

export function createDefaultChatBranching(headMid: string, createdAt: number, updatedAt: number) {
  const hid = String(headMid || '').trim()
  const ca = Number(createdAt || now())
  const ua = Number(updatedAt || ca || now())
  return {
    schemaVersion: CHAT_BRANCHING_SCHEMA_VERSION,
    activeBranchId: CHAT_DEFAULT_BRANCH_ID,
    branches: [{ id: CHAT_DEFAULT_BRANCH_ID, name: CHAT_DEFAULT_BRANCH_NAME, headMid: hid, createdAt: ca, updatedAt: ua, forkFromMid: '' }],
  }
}

export function normalizeChatBranching(raw: any, fallbackHeadMid: string, createdAt: number, updatedAt: number) {
  const r = raw && typeof raw === 'object' ? raw : null
  if (!r || Number((r as any).schemaVersion || 0) !== CHAT_BRANCHING_SCHEMA_VERSION) {
    return createDefaultChatBranching(fallbackHeadMid, createdAt, updatedAt)
  }

  const activeBranchId = normalizeBranchId((r as any).activeBranchId)
  const branches0 = Array.isArray((r as any).branches) ? (r as any).branches : []
  const branches = branches0
    .filter((b: any) => b && typeof b === 'object')
    .map((b: any) => ({
      id: normalizeBranchId(b.id),
      name: normalizeBranchName(b.name),
      headMid: String(b.headMid || '').trim(),
      createdAt: Number(b.createdAt || createdAt || now()),
      updatedAt: Number(b.updatedAt || updatedAt || b.createdAt || now()),
      forkFromMid: String(b.forkFromMid || '').trim(),
    }))

  const byId = new Map<string, any>()
  for (const b of branches) {
    if (!b?.id || byId.has(b.id)) continue
    byId.set(b.id, b)
  }

  if (!byId.has(activeBranchId)) {
    byId.set(activeBranchId, {
      id: activeBranchId,
      name: activeBranchId === CHAT_DEFAULT_BRANCH_ID ? CHAT_DEFAULT_BRANCH_NAME : '分支',
      headMid: String(fallbackHeadMid || '').trim(),
      createdAt: Number(createdAt || now()),
      updatedAt: Number(updatedAt || createdAt || now()),
      forkFromMid: '',
    })
  }

  return { schemaVersion: CHAT_BRANCHING_SCHEMA_VERSION, activeBranchId, branches: Array.from(byId.values()).slice(0, 200) }
}

export function rebuildLinearBranchingMessages(messages: any[], branchId: string) {
  const bid = normalizeBranchId(branchId)
  const list = Array.isArray(messages) ? messages : []
  let prev = ''
  for (const m of list) {
    if (!m || typeof m !== 'object') continue
    ;(m as any).branchId = bid
    ;(m as any).parentMid = prev
    prev = String((m as any).id || '')
  }
  return prev
}

export function fillMissingBranchIdsOnly(messages: any[], branchId: string) {
  const bid = normalizeBranchId(branchId)
  const list = Array.isArray(messages) ? messages : []
  let last = ''
  for (const m of list) {
    if (!m || typeof m !== 'object') continue
    if (!String((m as any).branchId || '').trim()) (m as any).branchId = bid
    last = String((m as any).id || '')
  }
  return last
}

export function touchActiveBranchHead(chat: any) {
  const c = chat && typeof chat === 'object' ? chat : null
  if (!c) return
  const msgs = Array.isArray((c as any).messages) ? (c as any).messages : []
  const lastMid = msgs.length ? String((msgs[msgs.length - 1] as any)?.id || '') : ''
  const createdAt = Number((c as any).createdAt || now())
  const updatedAt = Number((c as any).updatedAt || createdAt || now())
  const branching = normalizeChatBranching((c as any).branching, lastMid, createdAt, updatedAt)
  ;(c as any).branching = branching
  const bid = normalizeBranchId((branching as any).activeBranchId)
  const b = ((branching as any).branches || []).find((x: any) => String(x?.id || '') === bid) || null
  if (b) { b.headMid = lastMid; b.updatedAt = updatedAt }
}

export function repairChatLinearBranching(chat: any) {
  const c = chat && typeof chat === 'object' ? chat : null
  if (!c) return
  const msgs = Array.isArray((c as any).messages) ? (c as any).messages : []
  const createdAt = Number((c as any).createdAt || now())
  const updatedAt = Number((c as any).updatedAt || createdAt || now())
  const lastMid0 = msgs.length ? String((msgs[msgs.length - 1] as any)?.id || '') : ''
  const branching = normalizeChatBranching((c as any).branching, lastMid0, createdAt, updatedAt)
  ;(c as any).branching = branching
  const activeBranchId = normalizeBranchId((branching as any).activeBranchId)
  const branches = Array.isArray((branching as any).branches) ? (branching as any).branches : []
  const idSet = new Set<string>()
  for (const b of branches) {
    const id = normalizeBranchId((b as any)?.id)
    if (id) idSet.add(id)
    if (idSet.size >= 2) break
  }
  let headMid = ''
  if (idSet.size >= 2) {
    fillMissingBranchIdsOnly(msgs, activeBranchId)
    const b0 = branches.find((x: any) => String(x?.id || '') === activeBranchId) || null
    const curHead = String((b0 as any)?.headMid || '').trim()
    const exists = !!curHead && msgs.some((m: any) => String(m?.id || '') === curHead)
    headMid = exists ? curHead : lastMid0
  } else {
    headMid = rebuildLinearBranchingMessages(msgs, activeBranchId)
  }
  const b = branches.find((x: any) => String(x?.id || '') === activeBranchId) || null
  if (b) { b.headMid = headMid; b.updatedAt = updatedAt }
}

export function ensureChatBranching(chat: any) {
  const c = chat && typeof chat === 'object' ? chat : null
  if (!c) return null
  const msgs = Array.isArray((c as any).messages) ? (c as any).messages : []
  const createdAt = Number((c as any).createdAt || now())
  const updatedAt = Number((c as any).updatedAt || createdAt || now())
  const lastMid = msgs.length ? String((msgs[msgs.length - 1] as any)?.id || '') : ''
  const branching = normalizeChatBranching((c as any).branching, lastMid, createdAt, updatedAt)
  ;(c as any).branching = branching
  return branching
}

export function findChatBranch(chat: any, branchId: string) {
  const branching = ensureChatBranching(chat)
  if (!branching) return null
  const bid = normalizeBranchId(branchId)
  const branches = Array.isArray((branching as any).branches) ? (branching as any).branches : []
  return branches.find((b: any) => String(b?.id || '') === bid) || null
}

export function ensureChatBranch(chat: any, branchId: string) {
  const branching = ensureChatBranching(chat)
  if (!branching) return null
  const bid = normalizeBranchId(branchId)
  const branches = Array.isArray((branching as any).branches) ? (branching as any).branches : []
  let b = branches.find((x: any) => String(x?.id || '') === bid) || null
  if (!b) {
    const t = now()
    b = { id: bid, name: bid === CHAT_DEFAULT_BRANCH_ID ? CHAT_DEFAULT_BRANCH_NAME : '分支', headMid: '', createdAt: t, updatedAt: t, forkFromMid: '' }
    branches.push(b)
    ;(branching as any).branches = branches.slice(0, 200)
  }
  return b
}

export function setChatActiveBranchId(chat: any, branchId: string) {
  const branching = ensureChatBranching(chat)
  if (!branching) return
  const bid = normalizeBranchId(branchId)
  ensureChatBranch(chat, bid)
  ;(branching as any).activeBranchId = bid
  ;(chat as any).branching = branching
}

export function setChatBranchHeadMid(chat: any, branchId: string, headMid: string) {
  const b = ensureChatBranch(chat, branchId)
  if (!b) return
  b.headMid = String(headMid || '').trim()
  b.updatedAt = Number((chat as any)?.updatedAt || now())
}

export function genUniqueBranchId(branching: any) {
  const branches = Array.isArray(branching?.branches) ? branching.branches : []
  const used = new Set<string>(branches.map((b: any) => normalizeBranchId(b?.id)))
  for (let i = 0; i < 12; i++) {
    const id = normalizeBranchId(uid('b'))
    if (!used.has(id)) return id
  }
  return normalizeBranchId(uid('b'))
}

export function findChatMessageById(chat: any, messageId: any) {
  const mid = String(messageId || '').trim()
  if (!mid) return null
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  return msgs.find((m: any) => m && typeof m === 'object' && String(m?.id || '') === mid) || null
}

export function findPrevAssistantMidForAssistant(chat: any, assistantMid: any) {
  const mid = String(assistantMid || '').trim()
  if (!mid) return ''
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  const aiIndex = msgs.findIndex((m: any) => String(m?.id || '') === mid)
  if (aiIndex < 0) return ''
  const target = msgs[aiIndex]
  if (!target || String(target?.role || '') !== 'assistant') return ''
  let userMid = String((target as any)?.parentMid || '').trim()
  let userMsg = userMid ? (msgs.find((m: any) => String(m?.id || '') === userMid) || null) : null
  if (!userMsg || String(userMsg?.role || '') !== 'user') {
    for (let i = aiIndex - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m && m.role === 'user') { userMsg = m; userMid = String(m?.id || '').trim(); break }
      if (m && m.role === 'assistant') break
    }
  }
  if (!userMsg || String(userMsg?.role || '') !== 'user') return ''
  const p0 = String((userMsg as any)?.parentMid || '').trim()
  const pMsg = p0 ? (msgs.find((m: any) => String(m?.id || '') === p0) || null) : null
  if (pMsg && pMsg.role === 'assistant') return String(pMsg.id || '').trim()
  const uidx = userMid ? msgs.findIndex((m: any) => String(m?.id || '') === userMid) : -1
  const start = uidx >= 0 ? uidx - 1 : aiIndex - 1
  for (let i = start; i >= 0; i--) {
    const m = msgs[i]
    if (m && m.role === 'assistant') return String(m?.id || '').trim()
  }
  return ''
}

export function findAssistantSiblingsByUserMid(chat: any, userMid: string) {
  const uid0 = String(userMid || '').trim()
  if (!uid0) return []
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  const list = msgs.filter((m: any) => m && m.role === 'assistant' && String(m?.parentMid || '').trim() === uid0)
  list.sort((a: any, b: any) => {
    const da = Number(a?.createdAt || 0)
    const db = Number(b?.createdAt || 0)
    if (da !== db) return da - db
    return String(a?.id || '').localeCompare(String(b?.id || ''))
  })
  return list
}
