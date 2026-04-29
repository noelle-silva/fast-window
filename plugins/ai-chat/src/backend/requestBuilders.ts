import { now, uid, trimSlash, isHttpBaseUrl, clampTemp, normImagePaths, clamp } from '../core/utils'

// ---- constants ----

const VERSION = 2
const SPLIT_META_KEY = 'meta/index'
const CHAT_DEFAULT_BRANCH_ID = 'main'

// ---- domain schema helpers ----

export function splitRoleKey(folder: unknown): string {
  return `roles/${String(folder || '')}/role`
}

export function splitChatKey(folder: unknown, chatId: unknown): string {
  return `chats/${String(folder || '')}/${String(chatId || '')}`
}

export function splitGroupKey(folder: unknown): string {
  return `groups/${String(folder || '')}/group`
}

export function splitGroupChatKey(folder: unknown, chatId: unknown): string {
  return `groups/${String(folder || '')}/chats/${String(chatId || '')}`
}

export function normalizeBranchId(input: unknown): string {
  let s = String(input || '').trim()
  if (!s) return CHAT_DEFAULT_BRANCH_ID
  if (s.length > 60) s = s.slice(0, 60).trim()
  s = s.replace(/[^a-zA-Z0-9._-]/g, '_')
  return s || CHAT_DEFAULT_BRANCH_ID
}

export function normalizeChatModelOverride(chat: unknown): { providerId: string; modelId: string } | null {
  const c = chat && typeof chat === 'object' ? chat as Record<string, unknown> : null
  const o = c && c.modelOverride && typeof c.modelOverride === 'object' ? c.modelOverride as Record<string, unknown> : null
  const providerId = String(o?.providerId || '').trim()
  const modelId = String(o?.modelId || '').trim()
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

// ---- history / content helpers ----

export function limitHistory(messages: unknown[], maxTurns: number): unknown[] {
  const list = Array.isArray(messages) ? messages : []
  const ua = list.filter((m) => m && ((m as any).role === 'user' || (m as any).role === 'assistant'))
  return ua.slice(Math.max(0, ua.length - maxTurns))
}

export function looksLikeImageDataUrl(s: unknown): boolean {
  return String(s || '').startsWith('data:image/')
}

function normalizeMessageAttachments(atts: unknown): Array<{ name?: string; fullLen?: number; sendLen?: number; text?: string }> {
  if (!Array.isArray(atts)) return []
  return atts
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({
      name: String((a as any)?.name || ''),
      fullLen: Number((a as any)?.fullLen || 0),
      sendLen: Number((a as any)?.sendLen || 0),
      text: String((a as any)?.text || ''),
    }))
}

export function buildUserTextForOpenAi(m: unknown): string {
  let base = String((m as any)?.content || '').trim()
  const atts = normalizeMessageAttachments((m as any)?.attachments)
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
    const text = String(a?.text || '')

    let header = ''
    if (fullLen > 0 && sendLen > 0 && sendLen < fullLen) {
      header = `附件：${name}（${sendLen}/${fullLen} 字符）`
    } else if (fullLen > 0) {
      header = `附件：${name}（${fullLen} 字符）`
    } else {
      header = `附件：${name}`
    }

    const body = text || ''
    blocks.push(`${header}\n\`\`\`\n${body}\n\`\`\``)
  }

  const attachmentText = blocks.join('\n\n')
  return base ? `${base}\n\n${attachmentText}` : attachmentText
}

// ---- request builders (with dependency injection) ----

export type RequestBuilderDeps = {
  storage: {
    get(key: string): Promise<unknown>
  }
  imageReader?: {
    read(path: string): Promise<string>
  }
}

export function buildOpenAiChatReqFromStorage(deps: RequestBuilderDeps, job: unknown) {
  const { storage, imageReader } = deps
  const j = job as any

  const roleId = String(j?.roleId || '')
  const chatId = String(j?.chatId || '')
  if (!roleId || !chatId) throw new Error('job 缺少 roleId/chatId')

  const metaRaw = storage.get(SPLIT_META_KEY)
  const roleReq = (async () => {
    const meta = await metaRaw as any
    if (!meta) throw new Error('存储未初始化')
    if (Number(meta?.schemaVersion || 0) !== 1) throw new Error('存储索引版本不支持')

    const folder = String(meta?.roleFolders?.[roleId] || '')
    if (!folder) throw new Error('角色不存在')

    const [r0, c0] = await Promise.all([
      storage.get(splitRoleKey(folder)),
      storage.get(splitChatKey(folder, chatId)),
    ])

    const role = r0 && typeof r0 === 'object' ? r0 as any : null
    if (!role) throw new Error('角色不存在')
    const chat = c0 && typeof c0 === 'object' ? c0 as any : null
    if (!chat) throw new Error('会话不存在')

    const providers = Array.isArray(meta?.settings?.providers) ? meta.settings.providers : []
    const fallbackPid = String(providers[0]?.id || '')

    let providerId = String(role?.modelRef?.providerId || fallbackPid)
    let modelId = String(role?.modelRef?.modelId || '').trim()

    const o = normalizeChatModelOverride(chat)
    if (o) {
      const p0 = providers.find((x: any) => String(x?.id || '') === o.providerId) || null
      if (p0) { providerId = o.providerId; modelId = o.modelId }
    }

    const p = providers.find((x: any) => String(x?.id || '') === providerId) || null
    if (!p) throw new Error('供应商不存在')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) throw new Error('Base URL 无效（需 http/https）')
    if (!apiKey) throw new Error('API Key 为空')
    if (!modelId) throw new Error('模型ID 为空')

    const cutoffMid = String(j?.cutoffMid || '').trim()
    const msgs0 = Array.isArray(chat.messages) ? chat.messages : []

    const branchIdRaw = String(j?.branchId || '').trim()
    const wantBranchId = branchIdRaw ? normalizeBranchId(branchIdRaw) : ''

    let historySource: any[] = []
    if (wantBranchId) {
      const byId = new Map<string, any>()
      for (const m of msgs0) {
        const id = String(m?.id || '').trim()
        if (!id || byId.has(id)) continue
        byId.set(id, m)
      }
      const assistantMid = String(j?.assistantMid || '').trim()
      const assistantMsg = assistantMid ? byId.get(assistantMid) || null : null
      let tailMid = assistantMsg ? String(assistantMsg?.parentMid || '').trim() : ''
      if (!tailMid) {
        for (let i = msgs0.length - 1; i >= 0; i--) {
          if (msgs0[i]?.role === 'user') { tailMid = String(msgs0[i]?.id || '').trim(); break }
        }
      }
      const chain: any[] = []
      const seen = new Set<string>()
      let cur = tailMid
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        const m = byId.get(cur) || null
        if (!m) break
        if (!(m.role === 'assistant' && m.pending)) chain.push(m)
        cur = String(m?.parentMid || '').trim()
      }
      chain.reverse()
      historySource = chain
    } else {
      let baseMsgs0 = msgs0
      if (cutoffMid) {
        const idx = msgs0.findIndex((m: any) => String(m?.id || '') === cutoffMid)
        if (idx >= 0) baseMsgs0 = msgs0.slice(0, idx)
      }
      historySource = baseMsgs0.filter((m: any) => !(m?.role === 'assistant' && m?.pending))
    }

    const history = limitHistory(historySource, 40)

    const sys = String(role.systemPrompt || '').trim()
    const messages: any[] = []
    if (sys) messages.push({ role: 'system', content: sys })

    for (const m of history) {
      const r = m?.role === 'assistant' ? 'assistant' : 'user'
      const text = r === 'user' ? buildUserTextForOpenAi(m) : String(m?.content || '')
      if (r === 'user') {
        const paths = normImagePaths(m?.images)
        if (paths.length) {
          if (typeof imageReader?.read !== 'function') throw new Error('未授权：files.images.read')
          const parts: any[] = [{ type: 'text', text }]
          for (const path of paths) {
            let dataUrl = ''
            try {
              dataUrl = await imageReader.read(path)
            } catch (e: any) {
              throw new Error(`读取图片失败：${String(e?.message || e || 'unknown')}`)
            }
            if (!looksLikeImageDataUrl(dataUrl)) throw new Error('读取图片失败：格式不支持')
            parts.push({ type: 'image_url', image_url: { url: dataUrl } })
          }
          messages.push({ role: 'user', content: parts })
          continue
        }
      }
      messages.push({ role: r, content: text })
    }

    const stream = !!j?.stream
    return {
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, temperature: clampTemp(role.temperature), stream }),
      timeoutMs: stream ? 15 * 60 * 1000 : 120000,
    }
  })()

  return roleReq
}

export function buildOpenAiGroupChatReqFromStorage(deps: RequestBuilderDeps, job: unknown) {
  const { storage, imageReader } = deps
  const j = job as any

  const roleId = String(j?.roleId || '').trim()
  const groupId = String(j?.groupId || '').trim()
  const chatId = String(j?.chatId || '').trim()
  if (!roleId || !groupId || !chatId) throw new Error('job 缺少 groupId/roleId/chatId')

  const metaRaw = storage.get(SPLIT_META_KEY)
  const groupReq = (async () => {
    const meta = await metaRaw as any
    if (!meta) throw new Error('存储未初始化')
    if (Number(meta?.schemaVersion || 0) !== 1) throw new Error('存储索引版本不支持')

    const roleFolder = String(meta?.roleFolders?.[roleId] || '')
    if (!roleFolder) throw new Error('角色不存在')
    const groupFolder = String(meta?.groupFolders?.[groupId] || '')
    if (!groupFolder) throw new Error('群组不存在')

    const [r0, g0, c0] = await Promise.all([
      storage.get(splitRoleKey(roleFolder)),
      storage.get(splitGroupKey(groupFolder)),
      storage.get(splitGroupChatKey(groupFolder, chatId)),
    ])

    const role = r0 && typeof r0 === 'object' ? r0 as any : null
    if (!role) throw new Error('角色不存在')
    const group = g0 && typeof g0 === 'object' ? g0 as any : null
    if (!group) throw new Error('群组不存在')
    const chat = c0 && typeof c0 === 'object' ? c0 as any : null
    if (!chat) throw new Error('会话不存在')

    const providers = Array.isArray(meta?.settings?.providers) ? meta.settings.providers : []
    const fallbackPid = String(providers[0]?.id || '')

    let providerId = String(role?.modelRef?.providerId || fallbackPid)
    let modelId = String(role?.modelRef?.modelId || '').trim()

    const o = normalizeChatModelOverride(chat)
    if (o) {
      const p0 = providers.find((x: any) => String(x?.id || '') === o.providerId) || null
      if (p0) { providerId = o.providerId; modelId = o.modelId }
    }

    const p = providers.find((x: any) => String(x?.id || '') === providerId) || null
    if (!p) throw new Error('供应商不存在')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) throw new Error('Base URL 无效（需 http/https）')
    if (!apiKey) throw new Error('API Key 为空')
    if (!modelId) throw new Error('模型ID 为空')

    const cutoffMid = String(j?.cutoffMid || '').trim()
    const msgs0 = Array.isArray(chat.messages) ? chat.messages : []

    const branchIdRaw = String(j?.branchId || '').trim()
    const wantBranchId = branchIdRaw ? normalizeBranchId(branchIdRaw) : ''

    let historySource: any[] = []
    if (wantBranchId) {
      const byId = new Map<string, any>()
      for (const m of msgs0) {
        const id = String(m?.id || '').trim()
        if (!id || byId.has(id)) continue
        byId.set(id, m)
      }
      const assistantMid = String(j?.assistantMid || '').trim()
      const assistantMsg = assistantMid ? byId.get(assistantMid) || null : null
      let tailMid = assistantMsg ? String(assistantMsg?.parentMid || '').trim() : ''
      if (!tailMid) {
        for (let i = msgs0.length - 1; i >= 0; i--) {
          if (msgs0[i]?.role === 'user') { tailMid = String(msgs0[i]?.id || '').trim(); break }
        }
      }
      const chain: any[] = []
      const seen = new Set<string>()
      let cur = tailMid
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        const m = byId.get(cur) || null
        if (!m) break
        if (!(m.role === 'assistant' && m.pending)) chain.push(m)
        cur = String(m?.parentMid || '').trim()
      }
      chain.reverse()
      historySource = chain
    } else {
      let baseMsgs0 = msgs0
      if (cutoffMid) {
        const idx = msgs0.findIndex((m: any) => String(m?.id || '') === cutoffMid)
        if (idx >= 0) baseMsgs0 = msgs0.slice(0, idx)
      }
      historySource = baseMsgs0.filter((m: any) => !(m?.role === 'assistant' && m?.pending))
    }

    const history = limitHistory(historySource, 40)

    const sys = String(role.systemPrompt || '').trim()
    const messages: any[] = []
    if (sys) messages.push({ role: 'system', content: sys })

    for (const m of history) {
      const r = m?.role === 'assistant' ? 'assistant' : 'user'
      const text = r === 'user' ? buildUserTextForOpenAi(m) : String(m?.content || '')
      if (r === 'user') {
        const paths = normImagePaths(m?.images)
        if (paths.length) {
          if (typeof imageReader?.read !== 'function') throw new Error('未授权：files.images.read')
          const parts: any[] = [{ type: 'text', text }]
          for (const path of paths) {
            let dataUrl = ''
            try {
              dataUrl = await imageReader.read(path)
            } catch (e: any) {
              throw new Error(`读取图片失败：${String(e?.message || e || 'unknown')}`)
            }
            if (!looksLikeImageDataUrl(dataUrl)) throw new Error('读取图片失败：格式不支持')
            parts.push({ type: 'image_url', image_url: { url: dataUrl } })
          }
          messages.push({ role: 'user', content: parts })
          continue
        }
      }
      messages.push({ role: r, content: text })
    }

    const stream = !!j?.stream
    return {
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, temperature: clampTemp(role.temperature), stream }),
      timeoutMs: stream ? 15 * 60 * 1000 : 120000,
    }
  })()

  return groupReq
}
