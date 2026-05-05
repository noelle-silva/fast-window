import {
  VERSION,
  GROUP_SPEAKER_USER_PREFIX,
} from '../domain/constants'
import {
  splitRoleKey,
  splitChatKey,
  splitGroupKey,
  splitGroupChatKey,
} from '../domain/storageKeys'
import { normalizeBranchId } from '../domain/branching'
import { normalizeChatModelOverride } from '../domain/modelRefUtils'
import {
  buildUserTextForOpenAi,
  limitHistory,
  looksLikeImageDataUrl,
} from '../domain/textProcessing'
import { trimSlash, isHttpBaseUrl, clampTemp, normImagePaths } from '../core/utils'
import { normalizeData } from '../domain/dataNormalizers'
import { loadProvidersFromStorage, loadSplitMetaSnapshot } from '../storage/splitIndexes'

export function createBuildOpenAiReq(deps: {
  storage: { get: (key: string) => Promise<any> }
  filesImagesRead?: (req: { scope: string; path: string }) => Promise<string>
}) {
  const { storage, filesImagesRead } = deps

  async function loadSplitMeta() {
    return loadSplitMetaSnapshot(storage)
  }

  async function buildOpenAiChatReqFromStorage(job: any) {
    const roleId = String(job?.roleId || '')
    const chatId = String(job?.chatId || '')
    if (!roleId || !chatId) throw new Error('job 缺少 roleId/chatId')

    const meta = await loadSplitMeta()
    if (!meta) throw new Error('存储未初始化')

    const folder = String(meta.roleFolders?.[roleId] || '')
    if (!folder) throw new Error('角色不存在')

    const r0 = await storage.get(splitRoleKey(folder))
    const role = r0 && typeof r0 === 'object' ? r0 : null
    if (!role) throw new Error('角色不存在')

    const storedProviders = await loadProvidersFromStorage(storage, meta)
    const d = normalizeData({
      version: VERSION,
      settings: { ...(meta.settings && typeof meta.settings === 'object' ? meta.settings : {}), providers: storedProviders },
      roles: [role],
      chatsByRole: {},
      ui: meta.ui && typeof meta.ui === 'object' ? meta.ui : {},
    })

    const c0 = await storage.get(splitChatKey(folder, chatId))
    const chat = c0 && typeof c0 === 'object' ? c0 : null
    if (!chat) throw new Error('会话不存在')

    d.chatsByRole[String(roleId)] = { activeChatId: String(chatId), chats: [chat] }

    const fallbackPid = String(d?.settings?.providers?.[0]?.id || '')
    if (!role.modelRef || typeof role.modelRef !== 'object') role.modelRef = { providerId: fallbackPid, modelId: '' }
    if (!role.modelRef.providerId) role.modelRef.providerId = fallbackPid
    if (typeof role.modelRef.modelId !== 'string') role.modelRef.modelId = ''

    const providers: any[] = Array.isArray(d?.settings?.providers) ? d.settings.providers : []

    let providerId = String(role.modelRef?.providerId || '')
    let modelId = String(role.modelRef?.modelId || '').trim()
    const o = normalizeChatModelOverride(chat)
    if (o) {
      const p0 = providers.find((x: any) => String(x?.id || '') === o.providerId) || null
      if (p0) {
        providerId = o.providerId
        modelId = o.modelId
      }
    }

    const p = providers.find((x: any) => String(x?.id || '') === providerId) || null
    if (!p) throw new Error('供应商不存在')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) throw new Error('Base URL 无效（需 http/https）')
    if (!apiKey) throw new Error('API Key 为空')
    if (!modelId) throw new Error('模型ID 为空')

    const cutoffMid = String(job?.cutoffMid || '').trim()
    const msgs0: any[] = Array.isArray(chat.messages) ? chat.messages : []

    const branchIdRaw = String((job as any)?.branchId || '').trim()
    const wantBranchId = branchIdRaw ? normalizeBranchId(branchIdRaw) : ''

    let historySource: any[] = []
    if (wantBranchId) {
      const byId = new Map<string, any>()
      for (const m of msgs0) {
        const id = String(m?.id || '').trim()
        if (!id || byId.has(id)) continue
        byId.set(id, m)
      }

      const assistantMid = String(job?.assistantMid || '').trim()
      const assistantMsg = assistantMid ? byId.get(assistantMid) || null : null
      let tailMid = assistantMsg && typeof assistantMsg === 'object' ? String((assistantMsg as any)?.parentMid || '').trim() : ''

      if (!tailMid) {
        for (let i = msgs0.length - 1; i >= 0; i--) {
          const m = msgs0[i]
          if (m && m.role === 'user') {
            tailMid = String(m?.id || '').trim()
            break
          }
        }
      }

      const chain: any[] = []
      const seen = new Set<string>()
      let cur = tailMid
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        const m = byId.get(cur) || null
        if (!m) break
        if (!(m && m.role === 'assistant' && m.pending)) chain.push(m)
        cur = String((m as any)?.parentMid || '').trim()
      }
      chain.reverse()
      historySource = chain
    } else {
      let baseMsgs0 = msgs0
      if (cutoffMid) {
        const idx = msgs0.findIndex((m: any) => String(m?.id || '') === cutoffMid)
        if (idx >= 0) baseMsgs0 = msgs0.slice(0, idx)
      }
      historySource = baseMsgs0.filter((m: any) => !(m && m.role === 'assistant' && m.pending))
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
          if (typeof filesImagesRead !== 'function') throw new Error('未授权：files.images.read')
          const parts: any[] = [{ type: 'text', text }]
          for (const path of paths) {
            let dataUrl = ''
            try {
              dataUrl = await filesImagesRead({ scope: 'data', path })
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

    const stream = !!job?.stream
    return {
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, temperature: clampTemp(role.temperature), stream }),
      timeoutMs: stream ? 15 * 60 * 1000 : 120000,
    }
  }

  async function buildOpenAiGroupChatReqFromStorage(job: any) {
    const roleId = String(job?.roleId || '').trim()
    const groupId = String((job as any)?.groupId || '').trim()
    const chatId = String(job?.chatId || '').trim()
    if (!roleId || !groupId || !chatId) throw new Error('job 缺少 groupId/roleId/chatId')

    const meta = await loadSplitMeta()
    if (!meta) throw new Error('存储未初始化')

    const roleFolder = String(meta.roleFolders?.[roleId] || '')
    if (!roleFolder) throw new Error('角色不存在')
    const groupFolder = String((meta as any).groupFolders?.[groupId] || '')
    if (!groupFolder) throw new Error('群组不存在')

    const r0 = await storage.get(splitRoleKey(roleFolder))
    const role = r0 && typeof r0 === 'object' ? r0 : null
    if (!role) throw new Error('角色不存在')

    const g0 = await storage.get(splitGroupKey(groupFolder))
    const group = g0 && typeof g0 === 'object' ? g0 : null
    if (!group) throw new Error('群组不存在')

    const storedProviders = await loadProvidersFromStorage(storage, meta)
    const d = normalizeData({
      version: VERSION,
      settings: { ...(meta.settings && typeof meta.settings === 'object' ? meta.settings : {}), providers: storedProviders },
      roles: [role],
      chatsByRole: {},
      groups: [group],
      chatsByGroup: {},
      ui: meta.ui && typeof meta.ui === 'object' ? meta.ui : {},
    } as any)

    const c0 = await storage.get(splitGroupChatKey(groupFolder, chatId))
    const chat = c0 && typeof c0 === 'object' ? c0 : null
    if (!chat) throw new Error('会话不存在')
    ;(d as any).chatsByGroup[String(groupId)] = { activeChatId: String(chatId), chats: [chat] }

    const fallbackPid = String(d?.settings?.providers?.[0]?.id || '')
    if (!role.modelRef || typeof role.modelRef !== 'object') role.modelRef = { providerId: fallbackPid, modelId: '' }
    if (!role.modelRef.providerId) role.modelRef.providerId = fallbackPid
    if (typeof role.modelRef.modelId !== 'string') role.modelRef.modelId = ''

    const providers = Array.isArray(d?.settings?.providers) ? d.settings.providers : []

    let providerId = String(role.modelRef?.providerId || '')
    let modelId = String(role.modelRef?.modelId || '').trim()
    const o = normalizeChatModelOverride(chat)
    if (o) {
      const p0 = providers.find((x: any) => String(x?.id || '') === o.providerId) || null
      if (p0) {
        providerId = o.providerId
        modelId = o.modelId
      }
    }

    const p = providers.find((x: any) => String(x?.id || '') === providerId) || null
    if (!p) throw new Error('供应商不存在')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) throw new Error('Base URL 无效（需 http/https）')
    if (!apiKey) throw new Error('API Key 为空')
    if (!modelId) throw new Error('模型ID 为空')

    const cutoffMid = String(job?.cutoffMid || '').trim()
    const msgs0 = Array.isArray(chat.messages) ? chat.messages : []

    const branchIdRaw = String((job as any)?.branchId || '').trim()
    const wantBranchId = branchIdRaw ? normalizeBranchId(branchIdRaw) : ''

    let historySource: any[] = []
    if (wantBranchId) {
      const byId = new Map<string, any>()
      for (const m of msgs0) {
        const id = String(m?.id || '').trim()
        if (!id || byId.has(id)) continue
        byId.set(id, m)
      }

      const assistantMid = String(job?.assistantMid || '').trim()
      const assistantMsg = assistantMid ? byId.get(assistantMid) || null : null
      let tailMid = assistantMsg && typeof assistantMsg === 'object' ? String((assistantMsg as any)?.parentMid || '').trim() : ''

      if (!tailMid) {
        for (let i = msgs0.length - 1; i >= 0; i--) {
          const m = msgs0[i]
          if (m && m.role === 'user') {
            tailMid = String(m?.id || '').trim()
            break
          }
        }
      }

      const chain: any[] = []
      const seen = new Set<string>()
      let cur = tailMid
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        const m = byId.get(cur) || null
        if (!m) break
        if (!(m && m.role === 'assistant' && m.pending)) chain.push(m)
        cur = String((m as any)?.parentMid || '').trim()
      }
      chain.reverse()
      historySource = chain
    } else {
      let baseMsgs0 = msgs0
      if (cutoffMid) {
        const idx = msgs0.findIndex((m: any) => String(m?.id || '') === cutoffMid)
        if (idx >= 0) baseMsgs0 = msgs0.slice(0, idx)
      }
      historySource = baseMsgs0.filter((m: any) => !(m && m.role === 'assistant' && m.pending))
    }

    const history = limitHistory(historySource, 40)

    const sys = String(role.systemPrompt || '').trim()
    const groupPrompt = String((group as any).prompt || '').trim()

    const roleNameById = new Map<string, string>()
    const memberRoleIds = Array.isArray((group as any).memberRoleIds) ? (group as any).memberRoleIds : []
    const idsToLoad = Array.from(new Set([...memberRoleIds.map((x: any) => String(x || '')).filter(Boolean), roleId])).slice(0, 80)
    for (const rid of idsToLoad) {
      const folder = String(meta.roleFolders?.[rid] || '')
      if (!folder) continue
      try {
        const rr0 = await storage.get(splitRoleKey(folder))
        const rr = rr0 && typeof rr0 === 'object' ? rr0 : null
        if (!rr) continue
        roleNameById.set(rid, String((rr as any).name || '').trim() || 'AI')
      } catch (_) {}
    }
    if (!roleNameById.has(roleId)) roleNameById.set(roleId, String((role as any).name || '').trim() || 'AI')

    const speakerName = roleNameById.get(roleId) || 'AI'

    const messages: any[] = []
    if (sys) messages.push({ role: 'system', content: sys })
    messages.push({
      role: 'system',
      content: '你只能以你自己/当前这个成员的身份发言，不得冒充或代替其他任何群成员或用户说话。',
    })
    if (groupPrompt) messages.push({ role: 'system', content: `群聊设定：\n${groupPrompt}` })

    for (const m of history) {
      const r = m?.role === 'assistant' ? 'assistant' : 'user'
      if (r === 'user') {
        const baseText = buildUserTextForOpenAi(m)
        const wrappedText = `[${GROUP_SPEAKER_USER_PREFIX}的发言]: ${baseText}`.trimEnd()
        const paths = normImagePaths(m?.images)
        if (paths.length) {
          if (typeof filesImagesRead !== 'function') throw new Error('未授权：files.images.read')
          const parts: any[] = [{ type: 'text', text: wrappedText }]
          for (const path of paths) {
            let dataUrl = ''
            try {
              dataUrl = await filesImagesRead({ scope: 'data', path })
            } catch (e) {
              throw new Error(`读取图片失败：${String((e as any)?.message || e || 'unknown')}`)
            }
            if (!looksLikeImageDataUrl(dataUrl)) throw new Error('读取图片失败：格式不支持')
            parts.push({ type: 'image_url', image_url: { url: dataUrl } })
          }
          messages.push({ role: 'user', content: parts })
          continue
        }
        messages.push({ role: 'user', content: wrappedText })
        continue
      }

      const rid0 = String((m as any)?.speakerRoleId || '').trim()
      const name = roleNameById.get(rid0) || speakerName || 'AI'
      const text = String(m?.content || '')
      messages.push({ role: 'assistant', content: `[${name}的发言]: ${text}`.trimEnd() })
    }

    messages.push({
      role: 'user',
      content: `现在轮到你 ${speakerName} 发言了。系统已经为大家添加 [xxx的发言]: 这样的标记头，以用于区分不同发言来自谁。大家不用自己再输出自己的发言标记头，也不需要讨论发言标记系统，正常聊天即可。`,
    })

    const stream = !!job?.stream
    return {
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, temperature: clampTemp(role.temperature), stream }),
      timeoutMs: stream ? 15 * 60 * 1000 : 120000,
    }
  }

  async function loadToolCallServerConfigFromStorage() {
    const meta = await loadSplitMeta()
    if (!meta) throw new Error('存储未初始化')

    const d = normalizeData({
      version: VERSION,
      settings: { ...(meta.settings && typeof meta.settings === 'object' ? meta.settings : {}), providers: [{ id: '__fallback__', name: '__fallback__', baseUrl: 'http://', apiKey: '', modelsCache: { items: [], fetchedAt: 0 } }] },
      roles: [],
      chatsByRole: {},
      ui: meta.ui && typeof meta.ui === 'object' ? meta.ui : {},
    })

    const tcs = d.settings.toolCallServer && typeof d.settings.toolCallServer === 'object' ? d.settings.toolCallServer : {}
    const baseUrl = trimSlash(String((tcs as any).baseUrl || '').trim())
    const token = String((tcs as any).token || '').trim()
    const streamEnabled = !!d.settings.streamEnabled
    return { baseUrl, token, streamEnabled }
  }

  return {
    buildOpenAiChatReqFromStorage,
    buildOpenAiGroupChatReqFromStorage,
    loadToolCallServerConfigFromStorage,
  }
}
