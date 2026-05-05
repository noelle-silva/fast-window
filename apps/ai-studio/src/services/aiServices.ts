import { now, uid, trimSlash, isHttpBaseUrl } from '../core/utils'
import {
  extractMermaidCodeFromAiReply,
  replaceMermaidFenceOnce,
  normalizeAiGeneratedChatTitle,
  normalizeAiGeneratedStickerName,
  buildChatTranscriptForTitle,
} from '../domain/textProcessing'
import { validateStickerName } from '../domain/stickerValidator'
import {
  DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
  DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
  DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
} from '../domain/constants'

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms || 0))))

export interface AiServicesDeps {
  getState: () => any
  netRequest: (req: any) => Promise<any>
  filesImagesRead: (req: any) => Promise<string>
  aiGateway: {
    submitRawServiceRequest: (input: any) => Promise<void>
    consumeAssistantFinal: (mid: string) => Promise<any>
  }
  save: () => Promise<void>
  emit: () => void
  getProvider: (pid: string) => any
  getGroupById: (gid: string) => any
  ensureChatLoaded?: (rid: string, cid: string) => Promise<any>
  ensureGroupChatLoaded?: (gid: string, cid: string) => Promise<any>
  resolveAiModelId: (modelPick: any, customModelId: any) => string
  locateMessageInActiveChat: (mid: string) => any
  patchMessageContentSilent: (mid: string, content: string) => Promise<void>
  enqueueMermaidFixWrite: (mid: string, fn: () => Promise<string>) => Promise<any>
  chatHasPendingAssistant: (chat: any) => boolean
  renameChatTitle: (rid: string, cid: string, title: string) => void
  renameGroupChatTitle: (gid: string, cid: string, title: string) => void
}

export function createAiServices(deps: AiServicesDeps) {
  const {
    getState,
    netRequest,
    filesImagesRead,
    aiGateway,
    save,
    emit,
    getProvider,
    getGroupById,
    ensureChatLoaded,
    ensureGroupChatLoaded,
    resolveAiModelId,
    locateMessageInActiveChat,
    patchMessageContentSilent,
    enqueueMermaidFixWrite,
    chatHasPendingAssistant,
    renameChatTitle,
    renameGroupChatTitle,
  } = deps

  const chatTitleNamingWriteQueue = new Map<string, Promise<void>>()
  const stickerNamingWriteQueue = new Map<string, Promise<void>>()

  function enqueueChatTitleNamingWriteKey(keyRaw: any, fn: any) {
    const key = String(keyRaw || '').trim()
    if (!key) return Promise.reject(new Error('未找到会话ID'))
    const prev = chatTitleNamingWriteQueue.get(key) || Promise.resolve()
    const run = prev.catch(() => {}).then(fn)
    const completion = run.then(
      () => {},
      () => {},
    )
    chatTitleNamingWriteQueue.set(key, completion)
    completion.finally(() => {
      if (chatTitleNamingWriteQueue.get(key) === completion) chatTitleNamingWriteQueue.delete(key)
    })
    return run
  }

  function enqueueChatTitleNamingWrite(roleId: any, chatId: any, fn: any) {
    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    if (!rid || !cid) return Promise.reject(new Error('未找到会话ID'))
    const key = `role:${rid}:${cid}`
    return enqueueChatTitleNamingWriteKey(key, fn)
  }

  function enqueueStickerNamingWrite(categoryName: any, stickerName: any, fn: any) {
    const cat = String(categoryName || '').trim()
    const name = String(stickerName || '').trim()
    if (!cat || !name) return Promise.reject(new Error('未找到表情包ID'))

    const key = `${cat}:${name}`
    const prev = stickerNamingWriteQueue.get(key) || Promise.resolve()
    const run = prev.catch(() => {}).then(fn)
    const completion = run.then(
      () => {},
      () => {},
    )
    stickerNamingWriteQueue.set(key, completion)
    completion.finally(() => {
      if (stickerNamingWriteQueue.get(key) === completion) stickerNamingWriteQueue.delete(key)
    })
    return run
  }

  async function requestOpenAiChatOnce(req: any) {
    const purpose = String(req?.purpose || '').trim() || 'misc'
    const providerId = String(req?.providerId || '').trim()
    const modelId = String(req?.modelId || '').trim()
    const systemPrompt = String(req?.systemPrompt ?? '').trim()
    const userContent = String(req?.userContent ?? '').trim()
    const userMessagesRaw = Array.isArray(req?.userMessages) ? req.userMessages : null
    const userMessages = userMessagesRaw ? userMessagesRaw.map((x: any) => String(x ?? '').trim()).filter((x: string) => !!x).slice(0, 6) : null
    const userPartsRaw = Array.isArray(req?.userParts) ? req.userParts : null
    const userParts = userPartsRaw ? userPartsRaw.slice(0, 12) : null

    if (!providerId) throw new Error('供应商ID 为空')
    const p = getProvider(providerId)
    if (!p) throw new Error('供应商不存在')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) throw new Error('Base URL 无效（需 http/https）')
    if (!apiKey) throw new Error('API Key 为空')
    if (!modelId) throw new Error('模型ID 为空')
    if (userParts && !userParts.length) throw new Error('用户消息为空')
    if (userMessages && !userMessages.length) throw new Error('用户消息为空')
    if (!userParts && !userMessages && !userContent) throw new Error('用户消息为空')

    if (typeof netRequest !== 'function') throw new Error('未授权：net.request')

    const messages: any[] = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    if (userParts) {
      messages.push({ role: 'user', content: userParts })
    } else if (userMessages) {
      for (const m of userMessages) messages.push({ role: 'user', content: m })
    } else {
      messages.push({ role: 'user', content: userContent })
    }

    const httpReq = {
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, temperature: 0, stream: false }),
      timeoutMs: 120000,
    }

    const assistantMid = uid('svc')
    const target = {
      kind: 'role',
      roleId: '__ai_service__',
      chatId: `svc:${purpose}`,
      branchId: 'main',
      assistantMid,
      tag: 'service',
      service: purpose,
    }

    const waitFinal = async (mid: string, timeoutMs: number) => {
      const deadline = now() + Math.max(2000, Math.floor(timeoutMs || 0))
      while (now() < deadline) {
        const fin = await aiGateway.consumeAssistantFinal(mid)
        if (fin && typeof fin === 'object') {
          const status = String(fin?.status || '').trim()
          const text = String(fin?.text || '')
          if (status && status !== 'succeeded') throw new Error(text || '请求失败')
          return text
        }
        await sleepMs(120)
      }
      throw new Error('AI 微服务请求超时（后台可能未启动或已卡住）')
    }

    await aiGateway.submitRawServiceRequest({ target: target as any, req: httpReq, stream: false })

    const out = await waitFinal(assistantMid, 140_000)
    return String(out || '')
  }

  async function aiFixMermaidInMessage(messageId: any, mermaidSrc: any, renderErrorMsg: any) {
    const state = getState()
    if (!state.data) throw new Error('数据未加载')

    const cfg = state.data?.settings?.aiServices?.mermaidFix || {}
    const enabled = !!cfg.enabled
    if (!enabled) throw new Error('未启用：Mermaid AI 修复（插件设置 → AI 微服务）')

    const providerId = String(cfg.providerId || '').trim()
    const modelId = resolveAiModelId(cfg.modelId, cfg.customModelId)
    const systemPrompt = typeof cfg.systemPrompt === 'string' ? cfg.systemPrompt : DEFAULT_MERMAID_FIX_SYSTEM_PROMPT

    const src = String(mermaidSrc || '').trim()
    if (!src) throw new Error('Mermaid 源码为空')

    const err = String(renderErrorMsg || '').trim()
    const userMessages = [`Mermaid 源码：\n${src}`, err ? `渲染错误信息：\n${err}` : ''].filter((x) => !!String(x || '').trim())

    const fixedPromise = requestOpenAiChatOnce({ purpose: 'mermaidFix', providerId, modelId, systemPrompt, userMessages }).then((reply) => {
      const fixed = extractMermaidCodeFromAiReply(reply)
      if (!fixed.trim()) throw new Error('AI 未返回 Mermaid 代码')
      return fixed
    })

    return enqueueMermaidFixWrite(messageId, async () => {
      const fixed = await fixedPromise
      const found = locateMessageInActiveChat(messageId)
      if (!found) throw new Error('未找到该消息')

      const raw = String(found.target?.content || '')
      const r = replaceMermaidFenceOnce(raw, src, fixed)
      if (!r.replaced) throw new Error('未能在消息中定位原 Mermaid 代码块（可能内容已变）')

      await patchMessageContentSilent(messageId, r.text)
      return fixed
    })
  }

  async function aiGenerateChatTitle(roleId: any, chatId: any) {
    const state = getState()
    if (!state.data) throw new Error('数据未加载')

    const cfg = (state.data?.settings?.aiServices as any)?.chatTitleNaming || {}
    const enabled = !!cfg.enabled
    if (!enabled) throw new Error('未启用：AI 聊天记录取名（插件设置 → AI 微服务）')

    const providerId = String(cfg.providerId || '').trim()
    const modelId = resolveAiModelId(cfg.modelId, cfg.customModelId)
    const systemPrompt = typeof cfg.systemPrompt === 'string' ? cfg.systemPrompt : DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT

    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    if (!rid || !cid) throw new Error('未找到会话ID')

    const chat = (await ensureChatLoaded?.(rid, cid)) || null
    if (!chat) throw new Error('会话不存在')
    if (chatHasPendingAssistant(chat)) throw new Error('会话正在生成中，请稍后再试')

    const userContent = buildChatTranscriptForTitle(chat, 24)
    if (!userContent) throw new Error('聊天记录为空，无法生成标题')

    return enqueueChatTitleNamingWrite(rid, cid, async () => {
      const reply = await requestOpenAiChatOnce({ purpose: 'chatTitleNaming', providerId, modelId, systemPrompt, userContent })
      const title = normalizeAiGeneratedChatTitle(reply)
      if (!title) throw new Error('AI 未返回标题')
      renameChatTitle(rid, cid, title)
      return title
    })
  }

  async function aiGenerateGroupChatTitle(groupId: any, chatId: any) {
    const state = getState()
    if (!state.data) throw new Error('数据未加载')

    const cfg = (state.data?.settings?.aiServices as any)?.chatTitleNaming || {}
    const enabled = !!cfg.enabled
    if (!enabled) throw new Error('未启用：AI 聊天记录取名（插件设置 → AI 微服务）')

    const providerId = String(cfg.providerId || '').trim()
    const modelId = resolveAiModelId(cfg.modelId, cfg.customModelId)
    const systemPrompt = typeof cfg.systemPrompt === 'string' ? cfg.systemPrompt : DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT

    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) throw new Error('未找到会话ID')

    const group = getGroupById(gid)
    if (!group) throw new Error('群组不存在')

    const chat = (await ensureGroupChatLoaded?.(gid, cid)) || null
    if (!chat) throw new Error('会话不存在')
    if (chatHasPendingAssistant(chat)) throw new Error('会话正在生成中，请稍后再试')

    const userContent = buildChatTranscriptForTitle(chat, 24)
    if (!userContent) throw new Error('聊天记录为空，无法生成标题')

    const key = `group:${gid}:${cid}`
    return enqueueChatTitleNamingWriteKey(key, async () => {
      const reply = await requestOpenAiChatOnce({ purpose: 'chatTitleNaming', providerId, modelId, systemPrompt, userContent })
      const title = normalizeAiGeneratedChatTitle(reply)
      if (!title) throw new Error('AI 未返回标题')
      renameGroupChatTitle(gid, cid, title)
      return title
    })
  }

  async function aiGenerateStickerName(categoryName: any, stickerName: any) {
    const state = getState()
    if (!state.data) throw new Error('数据未加载')

    const cfg = (state.data?.settings?.aiServices as any)?.stickerNaming || {}
    const enabled = !!cfg.enabled
    if (!enabled) throw new Error('未启用：表情包取名服务（插件设置 → AI 微服务）')

    const providerId = String(cfg.providerId || '').trim()
    const modelId = resolveAiModelId(cfg.modelId, cfg.customModelId)
    const systemPrompt = typeof cfg.systemPrompt === 'string' ? cfg.systemPrompt : DEFAULT_STICKER_NAMING_SYSTEM_PROMPT

    const cat = String(categoryName || '').trim()
    const oldName = String(stickerName || '').trim()
    if (!cat || !oldName) throw new Error('表情包参数无效')

    const st = state.data.settings?.stickers
    const map = st && typeof st === 'object' ? (st as any).map : null
    const box = map && typeof map === 'object' ? map[cat] : null
    const it = box && typeof box === 'object' ? box[oldName] : null
    const relPath = it && typeof it === 'object' ? String((it as any).relPath || '').trim() : ''
    if (!relPath) throw new Error('未找到表情包图片路径')

    if (typeof filesImagesRead !== 'function') throw new Error('未授权：files.images.read')
    const imgUrl = await filesImagesRead({ scope: 'data', path: relPath }).catch(() => '')
    const url = String(imgUrl || '').trim()
    if (!url) throw new Error('读取表情包图片失败')

    return enqueueStickerNamingWrite(cat, oldName, async () => {
      const userText =
        `请根据这张表情包图片取一个简短中文名字，用作 token [[sticker:${cat}/名称]] 的"名称"。\n` +
        `限制：不要包含 / 或 \\ 或 ] 或换行；只输出名字本身。\n` +
        `当前分类：${cat}\n当前名称：${oldName}`

      const reply = await requestOpenAiChatOnce({
        purpose: 'stickerNaming',
        providerId,
        modelId,
        systemPrompt,
        userParts: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url } },
        ],
      })

      const next0 = normalizeAiGeneratedStickerName(reply)
      const v = validateStickerName(next0)
      if (!v.ok) throw new Error(v.error || '表情名无效')
      const nextName = v.name

      if (nextName === oldName) return nextName

      const s2 = getState()
      if (!s2.data) throw new Error('数据未加载')
      if (!s2.data.settings.stickers || typeof s2.data.settings.stickers !== 'object') throw new Error('表情包配置不存在')
      const st2 = s2.data.settings.stickers as any
      if (!st2.map || typeof st2.map !== 'object') throw new Error('表情包映射损坏')
      if (!st2.map[cat] || typeof st2.map[cat] !== 'object') throw new Error('分类不存在')
      const box2 = st2.map[cat] as any

      const it2 = box2[oldName]
      if (!it2 || typeof it2 !== 'object') throw new Error('表情不存在')
      if (box2[nextName]) throw new Error('重名：该分类下已存在同名表情')

      const rp = String((it2 as any).relPath || '').trim()
      if (!rp) throw new Error('映射损坏：缺少 relPath')

      const t = now()
      const createdAt = Number((it2 as any).createdAt || t)
      const next = { relPath: rp, createdAt, updatedAt: t }
      box2[nextName] = next
      try {
        delete box2[oldName]
      } catch (_) {}

      save().catch(() => {})
      emit()

      return nextName
    })
  }

  return {
    requestOpenAiChatOnce,
    aiFixMermaidInMessage,
    aiGenerateChatTitle,
    aiGenerateGroupChatTitle,
    aiGenerateStickerName,
  }
}
