// ai-chat (iframe sandbox) (entry: index.js)
import { now, uid, esc, trimSlash, isHttpBaseUrl, clampTemp, normImagePaths, clamp } from './core/utils'
import { extractOpenAiDelta, sseFeed } from './core/sse'
import { createDefaultAssistantRenderEngine } from './render/assistantEngineDefault'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import mammoth from 'mammoth/mammoth.browser'
;(function () {
  const api = window.fastWindow
  const BG_JOB_KEY_PREFIX = 'bg.job.'
  const BG_STREAM_KEY_PREFIX = 'bg.stream.'
  const BG_CANCEL_KEY_PREFIX = 'bg.cancel.'
  const BG_CANCEL_MID_KEY_PREFIX = 'bg.cancel.mid.'
  const BG_QUEUE_KEY = 'bg.queue'
  const VERSION = 2
  const SPLIT_SCHEMA_VERSION = 1
  const SPLIT_META_KEY = 'meta/index'
  const STICKERS_KEY = 'stickers/index'
  const runtime = String(api?.__meta?.runtime || 'ui')
  const MAX_DRAFT_IMAGES = 8
  const MAX_DRAFT_FILES = 6
  const MAX_DRAFT_FILE_BYTES = 10 * 1024 * 1024 // 10MB
  const MAX_DRAFT_FILE_TEXT_CHARS = 80_000
  const MAX_DRAFT_FILES_TOTAL_TEXT_CHARS = 200_000
  const REF_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA='
  const NEW_ROLE_ID = '__new__'
  const DEFAULT_MERMAID_FIX_SYSTEM_PROMPT = `你是 Mermaid 语法修复器。\n\n你会收到一段 Mermaid 源码（可能无法渲染）。你的任务：在尽量保持原意不变的前提下，修复语法/结构错误，让它可以被 Mermaid 渲染。\n\n输出要求：\n- 只输出修复后的 Mermaid 源码本体\n- 不要输出解释、不要输出 Markdown 代码块标记（不要输出 \`\`\`mermaid）`

  const uiRefImgCache = new Map()
  const uiRefImgPending = new Set()

  const state = {
    loading: true,
    sending: false,
    sendingJobId: '',
    sendingCtx: null,
    modal: '',
    mermaid: { items: [], index: 0, scale: 1 },
    imageViewer: { items: [], index: 0, scale: 1 },
    sideTab: 'roles', // roles | chats
    models: { loading: false, error: '', items: [] },
    pendingChat: null,
    draft: {
      input: '',
      images: [],
      files: [],
      activeRoleId: '',

      editRoleId: '',
      roleName: '',
      roleAvatar: '',
      roleAvatarImage: '',
      roleAvatarImageCropSrc: '',
      roleSystemPrompt: '',
      roleProviderId: '',
      roleModelId: '',
      roleCustomModelId: '',
      roleTemperature: '0.7',

      editProviderId: '',
      providerName: '',
      providerBaseUrl: '',
      providerApiKey: '',

      deleteRoleId: '',
      deleteProviderId: '',
    },
    data: null,
  }

  let ver = 0
  const subs = new Set()
  function emit() {
    ver++
    for (const fn of Array.from(subs)) {
      try {
        fn()
      } catch (_) {}
    }
  }
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {}
    subs.add(fn)
    return () => subs.delete(fn)
  }

  let splitMetaCache = null

  function safeDirName(input, fallback) {
    const raw = String(input || '')
      .replace(/\s+/g, ' ')
      .trim()
    const base = raw || String(fallback || '未命名')
    let s = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    s = s.replace(/[. ]+$/g, '').trim()
    if (!s) s = String(fallback || '未命名')

    const up = s.toUpperCase()
    const reserved =
      up === 'CON' ||
      up === 'PRN' ||
      up === 'AUX' ||
      up === 'NUL' ||
      /^COM[1-9]$/.test(up) ||
      /^LPT[1-9]$/.test(up) ||
      s === '.' ||
      s === '..'
    if (reserved) s = '_' + s

    if (s.length > 60) s = s.slice(0, 60).trim()
    return s || String(fallback || '未命名')
  }

  function roleFolderName(role) {
    return safeDirName(role?.name, '角色')
  }

  function validateStickerCategoryName(input) {
    const raw = String(input || '').trim()
    if (!raw) return { ok: false, name: '', error: '分类名不能为空' }
    if (raw.length > 60) return { ok: false, name: '', error: '分类名太长（最多 60 字符）' }
    if (raw.includes('/') || raw.includes('\\')) return { ok: false, name: '', error: '分类名不能包含 / 或 \\' }

    // 分类名会作为文件夹名使用；这里不做自动改名，避免 token 与落盘目录不一致。
    const safe = safeDirName(raw, '分类')
    if (safe !== raw) return { ok: false, name: '', error: '分类名包含不支持的字符' }

    return { ok: true, name: raw, error: '' }
  }

  function validateStickerName(input) {
    const raw = String(input || '').trim()
    if (!raw) return { ok: false, name: '', error: '表情名不能为空' }
    if (raw.length > 80) return { ok: false, name: '', error: '表情名太长（最多 80 字符）' }
    if (raw.includes('/') || raw.includes('\\')) return { ok: false, name: '', error: '表情名不能包含 / 或 \\' }
    if (raw.includes(']') || raw.includes('\n') || raw.includes('\r')) return { ok: false, name: '', error: '表情名包含不支持的字符' }
    return { ok: true, name: raw, error: '' }
  }

  function imageExtFromDataUrl(dataUrl) {
    const u = String(dataUrl || '').trim()
    const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(u)
    if (!m) return ''
    const mime = String(m[1] || '').toLowerCase()
    if (mime === 'png') return 'png'
    if (mime === 'gif') return 'gif'
    if (mime === 'webp') return 'webp'
    if (mime === 'jpeg' || mime === 'jpg') return 'jpg'
    return ''
  }

  async function addStickerInternal(cat, name, dataUrl) {
    if (!state.data) return { ok: false, kind: 'no-data' as const }
    if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') state.data.settings.stickers = { enabled: false, categories: [], map: {} }
    const st = state.data.settings.stickers

    if (!Array.isArray(st.categories)) st.categories = []
    if (!st.categories.some((x) => String(x || '') === cat)) st.categories = st.categories.concat([cat]).slice(0, 200)
    if (!st.map || typeof st.map !== 'object') st.map = {}
    if (!st.map[cat] || typeof st.map[cat] !== 'object') st.map[cat] = {}
    if (st.map[cat][name]) return { ok: false, kind: 'dup' as const }

    const u = String(dataUrl || '').trim()
    if (!looksLikeImageDataUrl(u)) return { ok: false, kind: 'bad-image' as const }
    const ext = imageExtFromDataUrl(u)
    if (!ext) return { ok: false, kind: 'bad-image' as const }

    if (typeof api?.files?.images?.writeBase64 !== 'function') return { ok: false, kind: 'no-perm' as const }

    const relPath = `stickers/${cat}/sticker-${uid('st')}.${ext}`
    await api.files.images.writeBase64({ scope: 'data', relPath, overwrite: false, dataUrlOrBase64: u })

    const t = now()
    st.map[cat][name] = { relPath, createdAt: t, updatedAt: t }
    return { ok: true, kind: 'ok' as const, relPath }
  }

  async function syncRoleAvatarFile(folder, role) {
    const f = String(folder || '').trim()
    if (!f) return

    const relPath = `roles/${f}/avatar.png`
    const avatarImage = String(role?.avatarImage || '').trim()

    if (looksLikeImageDataUrl(avatarImage)) {
      if (typeof api?.files?.images?.writeBase64 !== 'function') return
      await api.files.images
        .writeBase64({ scope: 'data', relPath, overwrite: true, dataUrlOrBase64: avatarImage })
        .catch(() => {})
      return
    }

    if (typeof api?.files?.images?.delete !== 'function') return
    await api.files.images.delete({ scope: 'data', path: relPath }).catch(() => {})
  }

  function splitRoleKey(folder) {
    return `roles/${String(folder || '')}/role`
  }

  function splitChatKey(folder, chatId) {
    return `chats/${String(folder || '')}/${String(chatId || '')}`
  }

  function normalizeSplitMeta(raw) {
    if (!raw || typeof raw !== 'object') return null
    const schemaVersion = Number(raw.schemaVersion || 0)
    if (schemaVersion !== SPLIT_SCHEMA_VERSION) return null

    const roleOrder = Array.isArray(raw.roleOrder) ? raw.roleOrder.map((x) => String(x || '')).filter((x) => !!x) : []
    const roleFolders = raw.roleFolders && typeof raw.roleFolders === 'object' ? raw.roleFolders : {}
    const chatIndexByRole = raw.chatIndexByRole && typeof raw.chatIndexByRole === 'object' ? raw.chatIndexByRole : {}

    return {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: Number(raw.dataVersion || VERSION),
      updatedAt: Number(raw.updatedAt || 0),
      ui: raw.ui && typeof raw.ui === 'object' ? raw.ui : {},
      settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
      roleOrder,
      roleFolders,
      chatIndexByRole,
    }
  }

  async function loadSplitMeta() {
    const raw = await api.storage.get(SPLIT_META_KEY)
    if (raw == null) return null
    const meta = normalizeSplitMeta(raw)
    if (!meta) throw new Error('存储索引损坏：meta/index 格式不正确')
    splitMetaCache = meta
    return meta
  }

  async function loadSplitData() {
    const meta = (await loadSplitMeta()) || splitMetaCache
    if (!meta) return null

    let stickers = null
    try {
      stickers = await api.storage.get(STICKERS_KEY)
    } catch (_) {
      stickers = null
    }

    const d = {
      version: VERSION,
      settings: meta.settings && typeof meta.settings === 'object' ? meta.settings : {},
      roles: [],
      chatsByRole: {},
      ui: meta.ui && typeof meta.ui === 'object' ? meta.ui : {},
    }

    // 表情包独立存储；不要混在 meta/index.settings 里。
    ;(d.settings as any).stickers = stickers && typeof stickers === 'object' ? stickers : {}

    for (const rid of meta.roleOrder) {
      const folder = String(meta.roleFolders?.[rid] || '')
      if (!folder) throw new Error('存储索引损坏：roleFolders 缺失')

      const r = await api.storage.get(splitRoleKey(folder))
      const role = r && typeof r === 'object' ? r : null
      if (!role) throw new Error('存储损坏：角色文件缺失或无效')

      d.roles.push(role)

      const idx = meta.chatIndexByRole?.[rid]
      const box = idx && typeof idx === 'object' ? idx : {}
      const activeChatId = String(box.activeChatId || '')
      const chatIds = Array.isArray(box.chatIds) ? box.chatIds.map((x) => String(x || '')).filter((x) => !!x) : []

      const chats = []
      for (const cid of chatIds) {
        const c0 = await api.storage.get(splitChatKey(folder, cid))
        const c = c0 && typeof c0 === 'object' ? c0 : null
        if (!c) throw new Error('存储损坏：会话文件缺失或无效')
        chats.push(c)
      }

      d.chatsByRole[String(role.id || rid)] = {
        activeChatId,
        chats,
      }
    }

    return normalizeData(d)
  }

  async function ensureSplitStoreReady() {
    const meta = (await loadSplitMeta()) || splitMetaCache
    if (meta) return
    await saveSplitData(defaultData())
  }

  async function saveSplitData(d) {
    if (!d || typeof d !== 'object') return
    const roles = Array.isArray(d.roles) ? d.roles : []
    const chatsByRole = d.chatsByRole && typeof d.chatsByRole === 'object' ? d.chatsByRole : {}

    const old = splitMetaCache || (await loadSplitMeta())
    const oldRoleFolders = old?.roleFolders && typeof old.roleFolders === 'object' ? old.roleFolders : {}
    const oldChatIndexByRole = old?.chatIndexByRole && typeof old.chatIndexByRole === 'object' ? old.chatIndexByRole : {}

    const roleOrder = roles.map((r) => String(r?.id || '')).filter((x) => !!x)
    const roleFolders = {}
    const chatIndexByRole = {}

    const usedFolders = new Set()
    for (const r of roles) {
      const rid = String(r?.id || '')
      if (!rid) continue
      const base = roleFolderName(r)
      let folder = base
      if (usedFolders.has(folder)) {
        const tail = rid.slice(Math.max(0, rid.length - 8)) || uid('r')
        folder = `${base}__${tail}`
      }
      usedFolders.add(folder)
      roleFolders[rid] = folder
    }

    for (const r of roles) {
      const rid = String(r?.id || '')
      if (!rid) continue
      const folder = String(roleFolders[rid] || '')
      const box0 = chatsByRole[rid] && typeof chatsByRole[rid] === 'object' ? chatsByRole[rid] : { activeChatId: '', chats: [] }
      const activeChatId = String(box0.activeChatId || '')
      const chats = Array.isArray(box0.chats) ? box0.chats : []
      const chatIds = chats.map((c) => String(c?.id || '')).filter((x) => !!x)
      const chatUpdatedAt = {}
      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        chatUpdatedAt[cid] = Number(c?.updatedAt || 0)
      }
      chatIndexByRole[rid] = { activeChatId, chatIds, chatUpdatedAt }

      // 角色文件：小，不做增量优化
      try {
        await api.storage.set(splitRoleKey(folder), r)
      } catch (_) {}

      await syncRoleAvatarFile(folder, r)

      const oldFolder = String(oldRoleFolders?.[rid] || '')
      const oldIdx = oldChatIndexByRole?.[rid]
      const oldUpdated = oldIdx && typeof oldIdx === 'object' && oldIdx.chatUpdatedAt && typeof oldIdx.chatUpdatedAt === 'object' ? oldIdx.chatUpdatedAt : {}

      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        const newKey = splitChatKey(folder, cid)
        const oldKey = oldFolder ? splitChatKey(oldFolder, cid) : ''
        const updatedAt = Number(c?.updatedAt || 0)
        const prev = Number(oldUpdated?.[cid] || 0)
        const needWrite = folder !== oldFolder || updatedAt !== prev || !prev
        if (!needWrite) continue
        try {
          await api.storage.set(newKey, c)
        } catch (_) {}
        if (oldKey && oldKey !== newKey) {
          try {
            await api.storage.remove(oldKey)
          } catch (_) {}
        }
      }
    }

    // 表情包独立存储；meta/index 只存“索引 + 通用 settings（不含 stickers）”。
    const settingsMeta = d.settings && typeof d.settings === 'object' ? { ...(d.settings as any) } : {}
    try {
      delete (settingsMeta as any).stickers
    } catch (_) {}

    try {
      const stickers = d.settings && typeof d.settings === 'object' ? (d.settings as any).stickers : null
      await api.storage.set(STICKERS_KEY, stickers && typeof stickers === 'object' ? stickers : {})
    } catch (_) {}

    const meta = {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: VERSION,
      updatedAt: now(),
      ui: d.ui && typeof d.ui === 'object' ? d.ui : {},
      settings: settingsMeta,
      roleOrder,
      roleFolders,
      chatIndexByRole,
    }

    // 先写索引，再清理旧文件：避免 crash 时出现“索引指向不存在文件”
    try {
      await api.storage.set(SPLIT_META_KEY, meta)
      splitMetaCache = meta
    } catch (_) {}

    // 清理：删除被移除的角色/会话；以及角色改名导致的旧目录文件
    if (old) {
      const newRoleSet = new Set(roleOrder)
      const newChatSetByRole = {}
      for (const rid of roleOrder) {
        const idx = chatIndexByRole?.[rid]
        const ids = Array.isArray(idx?.chatIds) ? idx.chatIds.map((x) => String(x || '')).filter((x) => !!x) : []
        newChatSetByRole[rid] = new Set(ids)
      }

      const oldRoles = Array.isArray(old.roleOrder) ? old.roleOrder : []
      for (const rid0 of oldRoles) {
        const rid = String(rid0 || '')
        if (!rid) continue
        const oldFolder = String(oldRoleFolders?.[rid] || '')
        if (!oldFolder) continue

        if (!newRoleSet.has(rid)) {
          try {
            await api.storage.remove(splitRoleKey(oldFolder))
          } catch (_) {}
          const oldIdx = oldChatIndexByRole?.[rid]
          const oldChatIds = Array.isArray(oldIdx?.chatIds) ? oldIdx.chatIds : []
          for (const cid0 of oldChatIds) {
            const cid = String(cid0 || '')
            if (!cid) continue
            try {
              await api.storage.remove(splitChatKey(oldFolder, cid))
            } catch (_) {}
          }
          continue
        }

        const newFolder = String(roleFolders?.[rid] || '')
        if (newFolder && newFolder !== oldFolder) {
          try {
            await api.storage.remove(splitRoleKey(oldFolder))
          } catch (_) {}
          const oldIdx = oldChatIndexByRole?.[rid]
          const oldChatIds = Array.isArray(oldIdx?.chatIds) ? oldIdx.chatIds : []
          for (const cid0 of oldChatIds) {
            const cid = String(cid0 || '')
            if (!cid) continue
            try {
              await api.storage.remove(splitChatKey(oldFolder, cid))
            } catch (_) {}
          }
          continue
        }

        const keep = newChatSetByRole[rid]
        const oldIdx = oldChatIndexByRole?.[rid]
        const oldChatIds = Array.isArray(oldIdx?.chatIds) ? oldIdx.chatIds : []
        for (const cid0 of oldChatIds) {
          const cid = String(cid0 || '')
          if (!cid) continue
          if (keep && keep.has(cid)) continue
          try {
            await api.storage.remove(splitChatKey(oldFolder, cid))
          } catch (_) {}
        }
      }
    }
  }

  async function readJobQueue() {
    try {
      const raw = await api.storage.get(BG_QUEUE_KEY)
      const list = Array.isArray(raw) ? raw : []
      return list.map((x) => String(x || '')).filter((x) => !!x).slice(0, 2000)
    } catch (_) {
      return []
    }
  }

  async function writeJobQueue(ids) {
    try {
      const list = Array.isArray(ids) ? ids.map((x) => String(x || '')).filter((x) => !!x) : []
      await api.storage.set(BG_QUEUE_KEY, list.slice(0, 2000))
    } catch (_) {}
  }

  async function enqueueJob(jobId) {
    const id = String(jobId || '')
    if (!id) return
    const q = await readJobQueue()
    if (q.includes(id)) return
    q.push(id)
    await writeJobQueue(q)
  }

  async function dequeueJob(jobId) {
    const id = String(jobId || '')
    if (!id) return
    const q = await readJobQueue()
    const out = q.filter((x) => x !== id)
    if (out.length === q.length) return
    await writeJobQueue(out)
  }

  function defaultData() {
    const providerName = '默认供应商（OpenAI 兼容）'
    const pid = providerName
    const rid = uid('r')
    const cid = uid('c')
        return {
          version: VERSION,
          settings: {
            streamEnabled: true,
            transparentChatBg: false,
            chatBgOpacity: 0,
            chatBgBlur: 0,
            topbarOpacity: 100,
            topbarBlur: 0,
            composerOpacity: 86,
            composerBlur: 10,
            userMessageCollapseEnabled: false,
            userMessageCollapseLines: 8,
            stickers: {
              enabled: false,
              categories: [],
              map: {},
            },
            aiServices: {
              mermaidFix: {
                enabled: false,
                providerId: pid,
                modelId: '',
                customModelId: '',
                systemPrompt: DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
              },
            },
            providers: [
              {
                id: pid,
                name: providerName,
                baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            modelsCache: { items: [], fetchedAt: 0 },
          },
        ],
      },
      roles: [
        {
          id: rid,
          name: '默认角色',
          avatar: '🤖',
          systemPrompt: '你是一个严谨、简洁的助手。',
          temperature: 0.7,
          modelRef: { providerId: pid, modelId: '' },
          createdAt: now(),
          updatedAt: now(),
        },
      ],
      chatsByRole: {
        [rid]: {
          activeChatId: cid,
          chats: [{ id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }],
        },
      },
      ui: { activeRoleId: rid },
    }
  }

  function normalizeData(raw) {
    const d0 = raw && typeof raw === 'object' ? raw : {}

    if (d0.version !== VERSION) throw new Error(`数据版本不支持：${String(d0.version)}（期望 ${VERSION}）`)
    const d = d0

    if (!d.settings || typeof d.settings !== 'object') d.settings = {}
    if (typeof d.settings.streamEnabled !== 'boolean') d.settings.streamEnabled = true
    if (typeof d.settings.transparentChatBg !== 'boolean') d.settings.transparentChatBg = false
    if (typeof d.settings.chatBgOpacity !== 'number' || !isFinite(d.settings.chatBgOpacity)) d.settings.chatBgOpacity = 0
    if (typeof d.settings.chatBgBlur !== 'number' || !isFinite(d.settings.chatBgBlur)) d.settings.chatBgBlur = 0
    if (typeof d.settings.topbarOpacity !== 'number' || !isFinite(d.settings.topbarOpacity)) d.settings.topbarOpacity = 100
    if (typeof d.settings.topbarBlur !== 'number' || !isFinite(d.settings.topbarBlur)) d.settings.topbarBlur = 0
    if (typeof d.settings.composerOpacity !== 'number' || !isFinite(d.settings.composerOpacity)) d.settings.composerOpacity = 86
    if (typeof d.settings.composerBlur !== 'number' || !isFinite(d.settings.composerBlur)) d.settings.composerBlur = 10
    if (typeof d.settings.userMessageCollapseEnabled !== 'boolean') d.settings.userMessageCollapseEnabled = false
    if (typeof d.settings.userMessageCollapseLines !== 'number' || !isFinite(d.settings.userMessageCollapseLines)) d.settings.userMessageCollapseLines = 8
    d.settings.chatBgOpacity = clamp(Math.round(Number(d.settings.chatBgOpacity || 0)), 0, 100)
    d.settings.chatBgBlur = clamp(Math.round(Number(d.settings.chatBgBlur || 0)), 0, 24)
    d.settings.topbarOpacity = clamp(Math.round(Number(d.settings.topbarOpacity || 0)), 0, 100)
    d.settings.topbarBlur = clamp(Math.round(Number(d.settings.topbarBlur || 0)), 0, 24)
    d.settings.composerOpacity = clamp(Math.round(Number(d.settings.composerOpacity || 0)), 40, 100)
    d.settings.composerBlur = clamp(Math.round(Number(d.settings.composerBlur || 0)), 0, 24)
    d.settings.userMessageCollapseLines = clamp(Math.round(Number(d.settings.userMessageCollapseLines || 8)), 1, 50)
    if (!Array.isArray(d.settings.providers) || d.settings.providers.length === 0) d.settings.providers = defaultData().settings.providers

    if (!d.settings.stickers || typeof d.settings.stickers !== 'object') d.settings.stickers = {}
    const st = d.settings.stickers
    if (typeof st.enabled !== 'boolean') st.enabled = false
    if (!Array.isArray(st.categories)) st.categories = []
    if (!st.map || typeof st.map !== 'object') st.map = {}

    // categories：仅保留非空字符串，去重，数量上限防爆。
    const catSet = new Set<string>()
    const cats: string[] = []
    for (const x of st.categories) {
      const s = typeof x === 'string' ? x.trim() : ''
      if (!s) continue
      if (s.length > 60) continue
      if (catSet.has(s)) continue
      catSet.add(s)
      cats.push(s)
      if (cats.length >= 200) break
    }
    st.categories = cats

    // map：只保留在 categories 里的分类；每个分类下只保留合法条目。
    const mapOut: Record<string, any> = {}
    for (const cat of st.categories) {
      const box = st.map && typeof st.map === 'object' ? (st.map as any)[cat] : null
      const outBox: Record<string, { relPath: string; createdAt: number; updatedAt: number }> = {}
      if (box && typeof box === 'object') {
        for (const [k, v] of Object.entries(box)) {
          const name = String(k || '').trim()
          if (!name || name.length > 80) continue
          const relPath = typeof (v as any)?.relPath === 'string' ? String((v as any).relPath || '').trim() : ''
          if (!relPath) continue
          outBox[name] = {
            relPath,
            createdAt: Number((v as any)?.createdAt || now()),
            updatedAt: Number((v as any)?.updatedAt || (v as any)?.createdAt || now()),
          }
        }
      }
      mapOut[cat] = outBox
    }
    st.map = mapOut

    if (!d.settings.aiServices || typeof d.settings.aiServices !== 'object') d.settings.aiServices = {}
    const as = d.settings.aiServices
    if (!as.mermaidFix || typeof as.mermaidFix !== 'object') as.mermaidFix = {}
    const mm = as.mermaidFix
    if (typeof mm.enabled !== 'boolean') mm.enabled = false
    const fallbackPid = String(d.settings.providers?.[0]?.id || '')
    if (typeof mm.providerId !== 'string') mm.providerId = fallbackPid
    if (!mm.providerId || !d.settings.providers.some((p) => String(p?.id || '') === String(mm.providerId || ''))) mm.providerId = fallbackPid
    if (typeof mm.modelId !== 'string') mm.modelId = ''
    if (typeof mm.customModelId !== 'string') mm.customModelId = ''
    if (typeof mm.systemPrompt !== 'string') mm.systemPrompt = DEFAULT_MERMAID_FIX_SYSTEM_PROMPT

    for (const p of d.settings.providers) {
      if (!p || typeof p !== 'object') continue
      if (typeof p.name !== 'string' || !p.name.trim()) p.name = '未命名供应商'
      if (typeof p.id !== 'string' || !p.id.trim()) p.id = String(p.name || '').trim() || uid('p')
      if (typeof p.baseUrl !== 'string' || !p.baseUrl.trim()) p.baseUrl = 'http://'
      if (typeof p.apiKey !== 'string') p.apiKey = ''
      if (!p.modelsCache || typeof p.modelsCache !== 'object') p.modelsCache = { items: [], fetchedAt: 0 }
      if (!Array.isArray(p.modelsCache.items)) p.modelsCache.items = []
      p.modelsCache.fetchedAt = Number(p.modelsCache.fetchedAt || 0)
    }

    if (!Array.isArray(d.roles) || d.roles.length === 0) d.roles = defaultData().roles

    for (const r of d.roles) {
      if (!r || typeof r !== 'object') continue
      if (!r.id) r.id = uid('r')
      if (typeof r.name !== 'string' || !r.name.trim()) r.name = '未命名角色'
      if (typeof r.avatar !== 'string' || !r.avatar.trim()) r.avatar = '🙂'
      if (typeof r.avatarImage !== 'string') r.avatarImage = ''
      if (r.avatarImage && !looksLikeImageDataUrl(r.avatarImage)) r.avatarImage = ''
      if (typeof r.systemPrompt !== 'string') r.systemPrompt = ''
      if (typeof r.temperature !== 'number' || !isFinite(r.temperature)) r.temperature = 0.7
      if (!r.modelRef || typeof r.modelRef !== 'object') r.modelRef = { providerId: String(d.settings.providers[0]?.id || ''), modelId: '' }
      if (typeof r.modelRef.providerId !== 'string') r.modelRef.providerId = String(d.settings.providers[0]?.id || '')
      if (typeof r.modelRef.modelId !== 'string') r.modelRef.modelId = ''
      const pid = String(r.modelRef.providerId || '')
      if (!d.settings.providers.some((p) => String(p?.id || '') === pid)) r.modelRef.providerId = String(d.settings.providers[0]?.id || '')
      r.createdAt = Number(r.createdAt || now())
      r.updatedAt = Number(r.updatedAt || now())
    }

    if (!d.chatsByRole || typeof d.chatsByRole !== 'object') d.chatsByRole = {}
    for (const r of d.roles) {
      const rid = String(r.id)
      if (!d.chatsByRole[rid] || typeof d.chatsByRole[rid] !== 'object') d.chatsByRole[rid] = { activeChatId: '', chats: [] }
      const box = d.chatsByRole[rid]
      if (!Array.isArray(box.chats)) box.chats = []
      box.activeChatId = String(box.activeChatId || '')

      box.chats = box.chats
        .filter((c) => c && typeof c === 'object')
        .map((c) => {
          const cc = c
          const cid = String(cc.id || uid('c'))
          const title = typeof cc.title === 'string' && cc.title.trim() ? cc.title : '新聊天'
          const createdAt = Number(cc.createdAt || now())
          const updatedAt = Number(cc.updatedAt || createdAt || now())
          const messages = Array.isArray(cc.messages) ? cc.messages : []
          return {
            id: cid,
            title,
            createdAt,
            updatedAt,
            messages: messages
              .filter((m) => m && typeof m === 'object')
                .map((m) => ({
                  id: String(m.id || uid('m')),
                  role: m.role === 'assistant' ? 'assistant' : 'user',
                  content: String(m.content || ''),
                  images: normImagePaths(m.images),
                  pending: !!m.pending,
                  streaming: !!m.streaming,
                  createdAt: Number(m.createdAt || now()),
                })),
            }
          })

      if (!box.chats.length) {
        const cid = uid('c')
        box.chats = [{ id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }]
        box.activeChatId = cid
      }

      if (!box.activeChatId || !box.chats.some((c) => String(c.id) === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
    }

    if (!d.ui || typeof d.ui !== 'object') d.ui = {}
    const activeRoleId = String(d.ui.activeRoleId || '')
    if (!activeRoleId || !d.roles.some((r) => String(r?.id) === activeRoleId)) d.ui.activeRoleId = String(d.roles[0]?.id || '')

    return d
  }

  if (runtime === 'background') {
    backgroundMain().catch(() => {})
    return
  }

  async function load() {
    try {
      await ensureSplitStoreReady()
      const split = await loadSplitData()
      if (!split) throw new Error('存储未初始化')
      state.data = split
      state.draft.activeRoleId = String(state.data?.ui?.activeRoleId || '')
    } catch (e) {
      state.data = null
      state.draft.activeRoleId = ''
      api.ui?.showToast?.(String(e?.message || e || '加载失败'))
    } finally {
      state.loading = false
    }
  }

  async function save() {
    if (!state.data) return
    state.data.ui.activeRoleId = String(state.draft.activeRoleId || '')
    await saveSplitData(state.data)
  }

  function getProvider(pid) {
    const ps = state.data?.settings?.providers
    if (!Array.isArray(ps)) return null
    return ps.find((p) => String(p?.id) === String(pid)) || null
  }

  function activeRole() {
    const rid = String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '')
    return state.data?.roles?.find((r) => String(r?.id) === rid) || null
  }

  function activeChatFromData() {
    const r = activeRole()
    if (!r || !state.data) return null
    const box = state.data.chatsByRole?.[String(r.id)]
    if (!box) return null
    const activeChatId = String(box.activeChatId || '')
    const chats = Array.isArray(box.chats) ? box.chats : []
    return chats.find((c) => String(c?.id) === activeChatId) || chats[0] || null
  }

  function activeChat() {
    const role = activeRole()
    const rid = String(role?.id || '')
    const pending = state.pendingChat
    if (pending && String(pending.roleId || '') === rid && pending.chat) return pending.chat
    return activeChatFromData()
  }

  function clearPendingChat() {
    state.pendingChat = null
  }

  function ensureRoleDefaults(role) {
    if (!state.data) return
    const fallbackPid = String(state.data.settings.providers?.[0]?.id || '')
    if (!role.modelRef || typeof role.modelRef !== 'object') role.modelRef = { providerId: fallbackPid, modelId: '' }
    if (!role.modelRef.providerId) role.modelRef.providerId = fallbackPid
    if (typeof role.modelRef.modelId !== 'string') role.modelRef.modelId = ''
  }


  function normalizeChatModelOverride(chat) {
    const c = chat && typeof chat === 'object' ? chat : null
    const o = c && c.modelOverride && typeof c.modelOverride === 'object' ? c.modelOverride : null
    const providerId = String(o?.providerId || '').trim()
    const modelId = String(o?.modelId || '').trim()
    if (!providerId || !modelId) return null
    return { providerId, modelId }
  }

  function pickChatModelRef(role, chat) {
    const o = normalizeChatModelOverride(chat)
    if (o) {
      const p0 = getProvider(o.providerId)
      if (p0) return { providerId: o.providerId, modelId: o.modelId, overridden: true }
    }
    const providerId = String(role?.modelRef?.providerId || '').trim()
    const modelId = String(role?.modelRef?.modelId || '').trim()
    return { providerId, modelId, overridden: false }
  }

  function loadScriptOnce(url, globalName) {
    return new Promise((resolve, reject) => {
      if (globalName && window[globalName]) return resolve(true)
      const s = document.createElement('script')
      s.src = url
      s.async = true
      s.onload = () => resolve(true)
      s.onerror = () => reject(new Error(`加载失败：${url}`))
      document.head.appendChild(s)
    })
  }

  function loadCssOnce(url, id) {
    if (id && document.getElementById(id)) return
    const link = document.createElement('link')
    if (id) link.id = id
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
  }

  const assistantRenderer = createDefaultAssistantRenderEngine()
  const { ensureRenderer, renderAssistantInto: renderAssistantIntoRaw, sanitizeHtml, sanitizeSvg } = assistantRenderer

  function getStickerRelPath(category, name) {
    const cat = typeof category === 'string' ? category.trim() : ''
    const nm = typeof name === 'string' ? name.trim() : ''
    if (!cat || !nm) return ''
    const st = state.data?.settings?.stickers
    const box = st && typeof st === 'object' ? st.map?.[cat] : null
    const it = box && typeof box === 'object' ? box[nm] : null
    const relPath = it && typeof it === 'object' ? String(it.relPath || '').trim() : ''
    return relPath
  }

  function renderAssistantInto(el, text) {
    const enabled = !!state.data?.settings?.stickers?.enabled
    renderAssistantIntoRaw(el, text, { stickersEnabled: enabled, getStickerPath: getStickerRelPath })
  }

  function mermaidItemsFromDom() {
    const chat = document.querySelector('[data-area="chat"]')
    const list = Array.from(chat?.querySelectorAll?.('.mermaid-block[data-mermaid="1"]') || [])
    const items = []
    for (const b of list) {
      if (!(b instanceof HTMLElement)) continue
      const svgEl = b.querySelector('svg')
      if (svgEl) items.push({ svg: sanitizeSvg(svgEl.outerHTML || '') })
      else items.push({ svg: sanitizeHtml(b.innerHTML || '') })
    }
    return { blocks: list, items }
  }

  function mermaidModalEls() {
    const root = document.querySelector('[data-mm-modal="1"]')
    if (!(root instanceof HTMLElement)) return null
    const stage = root.querySelector('[data-mm-stage="1"]')
    const canvas = root.querySelector('[data-mm-canvas="1"]')
    const label = root.querySelector('[data-mm-label="1"]')
    const zoom = root.querySelector('[data-mm-zoom="1"]')
    const prev = root.querySelector('[data-act="mm-prev"]')
    const next = root.querySelector('[data-act="mm-next"]')
    return {
      root,
      stage: stage instanceof HTMLElement ? stage : null,
      canvas: canvas instanceof HTMLElement ? canvas : null,
      label: label instanceof HTMLElement ? label : null,
      zoom: zoom instanceof HTMLElement ? zoom : null,
      prev: prev instanceof HTMLButtonElement ? prev : null,
      next: next instanceof HTMLButtonElement ? next : null,
    }
  }

  function applyMermaidScaleDom() {
    if (state.modal !== 'mermaid') return
    const els = mermaidModalEls()
    if (!els?.canvas) return
    const scale = clamp(state.mermaid.scale, 0.2, 6)
    state.mermaid.scale = scale
    els.canvas.style.transform = `scale(${scale})`
    if (els.zoom) els.zoom.textContent = `${Math.round(scale * 100)}%`
  }

  function renderMermaidModalDom(resetScroll) {
    if (state.modal !== 'mermaid') return
    const els = mermaidModalEls()
    if (!els?.canvas) return
    const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
    if (!len) return

    const idx = clamp(state.mermaid.index, 0, len - 1)
    state.mermaid.index = idx

    const svg = String(state.mermaid.items[idx]?.svg || '')
    els.canvas.innerHTML = svg || `<div class="muted">空图</div>`
    if (els.label) els.label.textContent = `${idx + 1}/${len}`
    if (els.prev) els.prev.disabled = len <= 1
    if (els.next) els.next.disabled = len <= 1

    if (resetScroll && els.stage) {
      els.stage.scrollTop = 0
      els.stage.scrollLeft = 0
    }

    applyMermaidScaleDom()
  }

  function openMermaidViewer(blockEl) {
    const srcEl = blockEl instanceof Element ? blockEl : null
    const r = mermaidItemsFromDom()
    if (!r.items.length) return

    let idx = 0
    if (srcEl) {
      const i = r.blocks.findIndex((b) => b === srcEl || (b instanceof HTMLElement && b.contains(srcEl)))
      if (i >= 0) idx = i
    }

    state.mermaid.items = r.items
    state.mermaid.index = idx
    state.mermaid.scale = 1
    state.modal = 'mermaid'
    renderModal()
    renderMermaidModalDom(true)
  }

  let mermaidDrag = null
  function cancelMermaidDrag() {
    const d = mermaidDrag
    if (!d) return
    mermaidDrag = null
    try {
      d.stage?.removeAttribute?.('data-mm-drag')
    } catch (_) {}
    try {
      window.removeEventListener('mousemove', onMouseMoveMermaid)
      window.removeEventListener('mouseup', onMouseUpMermaid)
      window.removeEventListener('blur', onMouseUpMermaid)
    } catch (_) {}
  }

  function onMouseMoveMermaid(e) {
    const d = mermaidDrag
    if (!d) return
    e.preventDefault()
    const dx = Number(e.clientX || 0) - d.x
    const dy = Number(e.clientY || 0) - d.y
    d.stage.scrollLeft = d.sl - dx
    d.stage.scrollTop = d.st - dy
  }

  function onMouseUpMermaid(_e) {
    if (!mermaidDrag) return
    cancelMermaidDrag()
  }

  async function refreshModels(providerId, force) {
    const p = getProvider(providerId)
    if (!p) return

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()

    if (!baseUrl || !isHttpBaseUrl(baseUrl)) {
      state.models = { loading: false, error: '请先配置 Base URL（http/https）', items: [] }
      render()
      return
    }
    if (!apiKey) {
      state.models = { loading: false, error: '请先配置 API Key', items: [] }
      render()
      return
    }

    const cache = p.modelsCache || { items: [], fetchedAt: 0 }
    const age = now() - Number(cache.fetchedAt || 0)
    if (!force && Array.isArray(cache.items) && cache.items.length && age < 5 * 60 * 1000) {
      state.models = { loading: false, error: '', items: cache.items.slice(0, 300) }
      render()
      return
    }

    state.models = { loading: true, error: '', items: [] }
    render()

    try {
      const r = await api.net.request({
        method: 'GET',
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: 20000,
      })

      const status = Number(r?.status || 0)
      const bodyText = String(r?.body || '')
      const json = JSON.parse(bodyText || '{}')
      if (status < 200 || status >= 300) throw new Error(json?.error?.message || bodyText || `HTTP ${status}`)

      const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : null
      if (!list) throw new Error('models 响应格式不支持（期望 data[] 或 models[]）')

      const ids = list
        .map((m) => (m && typeof m.id === 'string' ? m.id : ''))
        .filter((x) => !!x)
        .slice(0, 800)
        .sort((a, b) => String(a).localeCompare(String(b)))

      p.modelsCache = { items: ids, fetchedAt: now() }
      await save()

      state.models = { loading: false, error: '', items: ids.slice(0, 300) }
      api.ui?.showToast?.(`模型已刷新（${ids.length}）`)
    } catch (e) {
      state.models = { loading: false, error: String(e?.message || e || '获取模型失败'), items: [] }
      api.ui?.showToast?.(state.models.error || '获取模型失败')
    } finally {
      render()
    }
  }

  function resolveAiModelId(modelPick, customModelId) {
    const pick = String(modelPick || '').trim()
    if (!pick) return ''
    if (pick === '__custom__') return String(customModelId || '').trim()
    return pick
  }

  async function requestOpenAiChatOnce(req) {
    const providerId = String(req?.providerId || '').trim()
    const modelId = String(req?.modelId || '').trim()
    const systemPrompt = String(req?.systemPrompt ?? '').trim()
    const userContent = String(req?.userContent ?? '').trim()
    const userMessagesRaw = Array.isArray(req?.userMessages) ? req.userMessages : null
    const userMessages = userMessagesRaw ? userMessagesRaw.map((x) => String(x ?? '').trim()).filter((x) => !!x).slice(0, 6) : null

    if (!providerId) throw new Error('供应商ID 为空')
    const p = getProvider(providerId)
    if (!p) throw new Error('供应商不存在')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) throw new Error('Base URL 无效（需 http/https）')
    if (!apiKey) throw new Error('API Key 为空')
    if (!modelId) throw new Error('模型ID 为空')
    if (userMessages && !userMessages.length) throw new Error('用户消息为空')
    if (!userMessages && !userContent) throw new Error('用户消息为空')

    if (typeof api?.net?.request !== 'function') throw new Error('未授权：net.request')

    const messages = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    if (userMessages) {
      for (const m of userMessages) messages.push({ role: 'user', content: m })
    } else {
      messages.push({ role: 'user', content: userContent })
    }

    const r = await api.net.request({
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, temperature: 0, stream: false }),
      timeoutMs: 120000,
    })

    const status = Number(r?.status || 0)
    const bodyText = String(r?.body || '')
    let json = null
    try {
      json = JSON.parse(bodyText || '{}')
    } catch (_) {}

    if (status < 200 || status >= 300) {
      const msg = String(json?.error?.message || bodyText || `HTTP ${status}`)
      throw new Error(msg || `HTTP ${status}`)
    }

    let out = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? json?.output_text ?? ''
    out = String(out || '')
    return out
  }

  function extractMermaidCodeFromAiReply(input) {
    const text = String(input || '')
    const re = /```([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)```/g
    const blocks = []
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

  function tokenizeFencesForReplace(input) {
    const src = String(input || '')
    const lines = src.split('\n')

    const out = []
    const textBuf = []
    const flushText = () => {
      if (!textBuf.length) return
      out.push({ kind: 'text', text: textBuf.join('') })
      textBuf.length = 0
    }

    let inFence = false
    let fenceMarker = ''
    let fenceInfo = ''
    let openLineRaw = ''
    const fenceLinesRaw = []

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

  function replaceMermaidFenceOnce(markdown, oldCode, newCode) {
    const src = String(markdown || '').replace(/\r\n/g, '\n')
    const oldTrim = String(oldCode || '').trim()
    const nextTrim = String(newCode || '').trim()
    if (!oldTrim || !nextTrim) return { text: String(markdown || ''), replaced: false }

    const tokens = tokenizeFencesForReplace(src)
    const out = []
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

  function locateMessageInActiveChat(messageId) {
    const mid = String(messageId || '').trim()
    if (!mid) return null

    const role = activeRole()
    if (!role) return null

    const rid = String(role.id || '')
    const pendingChat = state.pendingChat && String(state.pendingChat.roleId || '') === rid ? state.pendingChat.chat : null
    const chat = pendingChat || activeChatFromData()
    if (!chat) return null

    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const target = msgs.find((m) => String(m?.id || '') === mid) || null
    if (!target) return null

    return { chat, pendingChat, target }
  }

  function chatHasPendingAssistant(chat) {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    for (const m of msgs) {
      if (!m || typeof m !== 'object') continue
      if (m.role === 'assistant' && m.pending) return true
    }
    return false
  }

  function findLastPendingAssistant(chat) {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (!m || typeof m !== 'object') continue
      if (m.role === 'assistant' && m.pending) return m
    }
    return null
  }

  const mermaidFixWriteQueue = new Map<string, Promise<void>>()

  function enqueueMermaidFixWrite(messageId, fn) {
    const mid = String(messageId || '').trim()
    if (!mid) return Promise.reject(new Error('未找到消息ID'))

    const prev = mermaidFixWriteQueue.get(mid) || Promise.resolve()
    const run = prev.catch(() => {}).then(fn)
    const completion = run.then(
      () => {},
      () => {},
    )
    mermaidFixWriteQueue.set(mid, completion)
    completion.finally(() => {
      if (mermaidFixWriteQueue.get(mid) === completion) mermaidFixWriteQueue.delete(mid)
    })
    return run
  }

  async function patchMessageContentSilent(messageId, content) {
    if (state.loading || !state.data) throw new Error('数据未加载')
    if (state.sending) throw new Error('操作中，请稍后重试')

    const found = locateMessageInActiveChat(messageId)
    if (!found) throw new Error('未找到该消息')

    const { chat, pendingChat, target } = found
    if (pendingChat) throw new Error('当前会话尚未写入存档，请先发送一条消息后再修复')
    if (chatHasPendingAssistant(chat)) throw new Error('该会话正在生成中，无法编辑')
    if (target.role === 'assistant') {
      if (target.pending) throw new Error('该消息正在生成中，无法编辑')
      try {
        uiStreamCache.delete(String(messageId || ''))
      } catch (_) {}
    }

    target.content = String(content ?? '')
    chat.updatedAt = now()
    emit()
    await save()

    try {
      const role = activeRole()
      const rid = String(role?.id || '')
      const cid = String(chat?.id || '')
      const mid = String(messageId || '')
      if (rid && cid && mid) {
        const meta = await loadSplitMeta()
        const folder = meta ? String(meta.roleFolders?.[rid] || '') : ''
        if (folder) {
          const raw = await api.storage.get(splitChatKey(folder, cid))
          const saved = raw && typeof raw === 'object' ? raw : null
          const msgs = Array.isArray(saved?.messages) ? saved.messages : []
          const m = msgs.find((x) => String(x?.id || '') === mid) || null
          const savedContent = m ? String(m.content ?? '') : ''
          const expected = String(target.content ?? '')
          if (savedContent !== expected) throw new Error('存档未更新（storage 写入可能失败或被拦截）')
        }
      }
    } catch (e) {
      throw new Error(String(e?.message || e || '存档校验失败'))
    }
  }

  async function aiFixMermaidInMessage(messageId, mermaidSrc, renderErrorMsg) {
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

    const fixedPromise = requestOpenAiChatOnce({ providerId, modelId, systemPrompt, userMessages }).then((reply) => {
      const fixed = extractMermaidCodeFromAiReply(reply)
      if (!fixed.trim()) throw new Error('AI 未返回 Mermaid 代码')
      return fixed
    })

    // 并行请求，按 messageId 串行落盘：避免同一条消息的多次替换互相覆盖/抢写。
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

  function limitHistory(messages, maxTurns) {
    const list = Array.isArray(messages) ? messages : []
    const ua = list.filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    return ua.slice(Math.max(0, ua.length - maxTurns))
  }

  function jobKey(jobId) {
    return `${BG_JOB_KEY_PREFIX}${String(jobId || '')}`
  }

  function streamKey(mid) {
    return `${BG_STREAM_KEY_PREFIX}${String(mid || '')}`
  }

  function cancelKey(jobId) {
    return `${BG_CANCEL_KEY_PREFIX}${String(jobId || '')}`
  }

  function cancelMidKey(mid) {
    return `${BG_CANCEL_MID_KEY_PREFIX}${String(mid || '')}`
  }

  function looksLikeImageDataUrl(s) {
    const t = String(s || '')
    return t.startsWith('data:image/')
  }

  function shrinkImageDataUrl(dataUrl, maxSide) {
    return new Promise((resolve) => {
      try {
        const u = String(dataUrl || '').trim()
        if (!looksLikeImageDataUrl(u)) return resolve('')

        const max = clamp(Math.round(Number(maxSide || 0)), 64, 4096)
        const img = new Image()
        img.decoding = 'async'
        img.onload = () => {
          try {
            const w0 = Number(img.naturalWidth || 0)
            const h0 = Number(img.naturalHeight || 0)
            if (!w0 || !h0) return resolve('')

            const s = Math.min(1, max / Math.max(w0, h0))
            const w = Math.max(1, Math.round(w0 * s))
            const h = Math.max(1, Math.round(h0 * s))

            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            if (!ctx) return resolve('')
            ctx.clearRect(0, 0, w, h)
            ctx.drawImage(img, 0, 0, w, h)

            const out = canvas.toDataURL('image/png')
            resolve(looksLikeImageDataUrl(out) ? out : '')
          } catch (_) {
            resolve('')
          }
        }
        img.onerror = () => resolve('')
        img.src = u
      } catch (_) {
        resolve('')
      }
    })
  }

  function addDraftImage(name, dataUrl) {
    if (!looksLikeImageDataUrl(dataUrl)) return false
    if (!Array.isArray(state.draft.images)) state.draft.images = []
    if (state.draft.images.length >= MAX_DRAFT_IMAGES) return false
    state.draft.images.push({ id: uid('img'), name: String(name || '图片'), dataUrl: String(dataUrl || '') })
    return true
  }

  type DraftFileKind = 'txt' | 'md' | 'pdf' | 'docx'
  type DraftFileItem = {
    id: string
    name: string
    size: number
    kind: DraftFileKind
    pending: boolean
    truncated: boolean
    text: string
    error: string
  }

  function fileExtLower(name: string) {
    const n = String(name || '')
    const i = n.lastIndexOf('.')
    if (i < 0) return ''
    return n.slice(i + 1).toLowerCase()
  }

  function detectDraftFileKind(file: File): DraftFileKind | '' {
    const ext = fileExtLower(file?.name || '')
    if (ext === 'txt') return 'txt'
    if (ext === 'md' || ext === 'markdown') return 'md'
    if (ext === 'pdf') return 'pdf'
    if (ext === 'docx') return 'docx'
    const mime = String(file?.type || '').toLowerCase()
    if (mime === 'text/plain') return 'txt'
    if (mime === 'text/markdown') return 'md'
    if (mime === 'application/pdf') return 'pdf'
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
    return ''
  }

  function clampText(s: string, maxChars: number) {
    const raw = String(s || '')
    if (raw.length <= maxChars) return { text: raw, truncated: false }
    return { text: raw.slice(0, Math.max(0, maxChars)).trimEnd(), truncated: true }
  }

  function escapeFence(s: string) {
    // 避免把附件内容里的 ``` 意外当成代码块结束
    return String(s || '').replaceAll('```', '``\u200b`')
  }

  function addDraftFilePlaceholder(file: File, kind: DraftFileKind): DraftFileItem | null {
    if (!Array.isArray(state.draft.files)) state.draft.files = []
    if (state.draft.files.length >= MAX_DRAFT_FILES) return null
    const it: DraftFileItem = {
      id: uid('f'),
      name: String(file?.name || '文件'),
      size: clamp(Number(file?.size || 0), 0, Number.MAX_SAFE_INTEGER),
      kind,
      pending: true,
      truncated: false,
      text: '',
      error: '',
    }
    state.draft.files.push(it)
    return it
  }

  function removeDraftFile(id: string) {
    const rid = String(id || '')
    if (!rid) return
    if (!Array.isArray(state.draft.files)) state.draft.files = []
    state.draft.files = state.draft.files.filter((x: any) => String(x?.id || '') !== rid)
  }

  async function extractPdfText(file: File): Promise<string> {
    const buf = await file.arrayBuffer()
    const doc = await (pdfjsLib as any)
      .getDocument({ data: new Uint8Array(buf), disableWorker: true })
      .promise
    const pages = clamp(Number(doc?.numPages || 0), 1, 200)
    const maxPages = Math.min(pages, 50)
    let out = ''
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      const items = Array.isArray(tc?.items) ? tc.items : []
      const parts = items
        .map((x: any) => (x && typeof x.str === 'string' ? String(x.str) : ''))
        .filter((x: string) => !!x)
      if (parts.length) out += parts.join(' ') + '\n'
      if (out.length >= MAX_DRAFT_FILE_TEXT_CHARS) break
    }
    try {
      doc?.cleanup?.()
    } catch (_) {}
    return String(out || '').trim()
  }

  async function extractDocxText(file: File): Promise<string> {
    const buf = await file.arrayBuffer()
    const r = await (mammoth as any).extractRawText({ arrayBuffer: buf })
    return String(r?.value || '').trim()
  }

  async function extractTextFromFile(file: File, kind: DraftFileKind) {
    if (!(file instanceof File)) throw new Error('file 无效')
    const size = Number(file?.size || 0)
    if (!isFinite(size) || size <= 0) throw new Error('文件为空')
    if (size > MAX_DRAFT_FILE_BYTES) throw new Error(`文件过大（> ${Math.round(MAX_DRAFT_FILE_BYTES / 1024 / 1024)}MB）`)

    if (kind === 'txt' || kind === 'md') {
      const t = await file.text()
      return clampText(String(t || '').trim(), MAX_DRAFT_FILE_TEXT_CHARS)
    }
    if (kind === 'pdf') {
      const t = await extractPdfText(file)
      return clampText(t, MAX_DRAFT_FILE_TEXT_CHARS)
    }
    if (kind === 'docx') {
      const t = await extractDocxText(file)
      return clampText(t, MAX_DRAFT_FILE_TEXT_CHARS)
    }
    throw new Error('不支持的文件类型')
  }

  async function addDraftFilesFromFiles(files: File[]) {
    if (state.loading || state.sending) return
    const list = Array.isArray(files) ? files.filter((f) => f instanceof File) : []
    if (!list.length) return
    if (!Array.isArray(state.draft.files)) state.draft.files = []

    const left = Math.max(0, MAX_DRAFT_FILES - state.draft.files.length)
    if (!left) return api.ui?.showToast?.(`最多选择 ${MAX_DRAFT_FILES} 个文件`)

    let added = 0
    for (const f of list.slice(0, left)) {
      const kind = detectDraftFileKind(f)
      if (!kind) {
        api.ui?.showToast?.(`不支持的文件：${String(f?.name || '文件')}`)
        continue
      }
      const it = addDraftFilePlaceholder(f, kind)
      if (!it) break
      added++
      emit()
      ;(async () => {
        try {
          const r = await extractTextFromFile(f, kind)
          const cur = Array.isArray(state.draft.files) ? state.draft.files.find((x: any) => String(x?.id || '') === it.id) : null
          if (!cur) return
          cur.text = String(r?.text || '')
          cur.truncated = !!r?.truncated
          if (!cur.text) cur.error = '未提取到文本'
        } catch (e) {
          const cur = Array.isArray(state.draft.files) ? state.draft.files.find((x: any) => String(x?.id || '') === it.id) : null
          if (!cur) return
          cur.error = String(e?.message || e || '解析失败')
        } finally {
          const cur = Array.isArray(state.draft.files) ? state.draft.files.find((x: any) => String(x?.id || '') === it.id) : null
          if (cur) cur.pending = false
          emit()
        }
      })().catch(() => {})
    }
    if (!added) api.ui?.showToast?.('未选择文件')
    emit()
  }

  function removeDraftImage(id) {
    const rid = String(id || '')
    if (!rid) return
    if (!Array.isArray(state.draft.images)) state.draft.images = []
    state.draft.images = state.draft.images.filter((x) => String(x?.id || '') !== rid)
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!(file instanceof File)) return reject(new Error('file 无效'))
      const r = new FileReader()
      r.onload = () => resolve(String(r.result || ''))
      r.onerror = () => reject(new Error('读取图片失败'))
      r.readAsDataURL(file)
    })
  }

  async function pickImages() {
    if (state.loading || state.sending) return
    if (typeof api?.files?.pickImages !== 'function') return api.ui?.showToast?.('未授权：files.pickImages')

    const left = Math.max(0, MAX_DRAFT_IMAGES - (Array.isArray(state.draft.images) ? state.draft.images.length : 0))
    if (!left) return api.ui?.showToast?.(`最多选择 ${MAX_DRAFT_IMAGES} 张图片`)

    try {
      const items = await api.files.pickImages(left)
      const list = Array.isArray(items) ? items : []
      let added = 0
      for (const it of list) {
        const name = String(it?.name || '图片')
        const dataUrl = String(it?.dataUrl || '')
        if (addDraftImage(name, dataUrl)) added++
      }
      if (!added) api.ui?.showToast?.('未选择图片')
    } catch (e) {
      api.ui?.showToast?.(String(e?.message || e || '选择图片失败'))
    } finally {
      renderComposer()
    }
  }

  async function sendChat() {
    if (state.sending || state.loading || !state.data) return

    const role = activeRole()
    if (!role) return
    ensureRoleDefaults(role)

    const input = String(state.draft.input || '').trim()
    const draftImages = Array.isArray(state.draft.images) ? state.draft.images : []
    const draftFiles: DraftFileItem[] = Array.isArray((state.draft as any).files) ? ((state.draft as any).files as any[]) : []
    const hasFiles = draftFiles.length > 0
    if (!input && !draftImages.length && !hasFiles) return api.ui?.showToast?.('输入不能为空')
    if (hasFiles && draftFiles.some((x: any) => !!x?.pending)) return api.ui?.showToast?.('文件解析中，请稍候…')

    const rid = String(role.id || '')
    const chatForModel = state.pendingChat && String(state.pendingChat.roleId || '') === rid ? null : activeChatFromData()
    const picked = pickChatModelRef(role, chatForModel)

    const providerId = String(picked.providerId || '')
    const modelId = String(picked.modelId || '').trim()
    const p = getProvider(providerId)
    if (!p) return api.ui?.showToast?.('未找到该供应商')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()

    if (!isHttpBaseUrl(baseUrl)) return api.ui?.showToast?.('请在供应商设置里配置 Base URL（http/https）')
    if (!apiKey) return api.ui?.showToast?.('请在供应商设置里配置 API Key')
    if (!modelId) {
      return api.ui?.showToast?.(picked.overridden ? '请先为“当前会话临时模型”选择模型ID' : '请在角色设置里选择模型（供应商 + 模型ID）')
    }

    let chat = null

    let assistantMid = ''
    try {
      if (draftImages.length && typeof api?.files?.images?.writeBase64 !== 'function') {
        return api.ui?.showToast?.('未授权：files.images.writeBase64')
      }

      state.sending = true
      renderComposer()

      const savedPaths = []
      for (const img of draftImages.slice(0, MAX_DRAFT_IMAGES)) {
        const dataUrl = String(img?.dataUrl || '')
        if (!looksLikeImageDataUrl(dataUrl)) continue
        const saved = await api.files.images.writeBase64({ scope: 'data', dataUrlOrBase64: dataUrl })
        const path = String(saved || '').trim()
        if (path) savedPaths.push(path)
      }

      const streamEnabled = !!state.data?.settings?.streamEnabled
      assistantMid = uid('m')

      if (state.pendingChat && String(state.pendingChat.roleId || '') === rid) {
        chat = createChatForRole(rid)
        clearPendingChat()
      } else {
        chat = activeChatFromData()
        if (!chat) chat = createChatForRole(rid)
      }
      if (!chat) throw new Error('创建会话失败')
      if (chatHasPendingAssistant(chat)) throw new Error('该会话正在生成中，请先停止或等待完成')

      const wasEmpty = !Array.isArray(chat.messages) || chat.messages.length === 0
      const parts: string[] = []
      if (input) parts.push(input)
      if (hasFiles) {
        let total = 0
        for (const f of draftFiles) {
          if (!f || f.pending) continue
          if (String(f?.error || '')) continue
          const name = String(f?.name || '文件')
          const kind = String(f?.kind || 'txt')
          const lang = kind === 'md' ? 'markdown' : 'text'
          const header = `附件：${name}${f.truncated ? '（已截断）' : ''}`
          const body = escapeFence(String(f?.text || '').trim())
          if (!body) continue
          const block = `${header}\n\`\`\`${lang}\n${body}\n\`\`\``
          if (total + block.length > MAX_DRAFT_FILES_TOTAL_TEXT_CHARS) {
            const remain = Math.max(0, MAX_DRAFT_FILES_TOTAL_TEXT_CHARS - total)
            const overhead = (`${header}\n\`\`\`${lang}\n\n\`\`\``).length
            const avail = Math.max(0, remain - overhead)
            const snippet = avail > 200 ? body.slice(0, avail).trimEnd() : ''
            if (snippet) parts.push(`${header}\n\`\`\`${lang}\n${snippet}\n\`\`\``)
            parts.push('（附件内容过长，已截断）')
            break
          }
          parts.push(block)
          total += block.length
        }
      }
      const finalInput = parts.join('\n\n').trim()
      if (!finalInput && !savedPaths.length) throw new Error('没有可发送的内容（文件解析失败或为空）')

      chat.messages.push({ id: uid('m'), role: 'user', content: finalInput, images: savedPaths, createdAt: now() })
      chat.updatedAt = now()
      if (wasEmpty && String(chat.title || '') === '新聊天') {
        const t = finalInput.replace(/\s+/g, ' ').trim()
        const base = t || (savedPaths.length ? '图片' : hasFiles ? '文件' : '新聊天')
        chat.title = base.length > 16 ? base.slice(0, 16) + '…' : base || '新聊天'
      }

      state.draft.input = ''
      state.draft.images = []
      ;(state.draft as any).files = []

      chat.messages.push({
        id: assistantMid,
        role: 'assistant',
        content: '（生成中…）',
        pending: true,
        streaming: streamEnabled,
        createdAt: now(),
      })
      chat.updatedAt = now()

      const jobId = uid('job')
      const job = {
        id: jobId,
        kind: 'openai.chat.completions',
        status: 'queued',
        createdAt: now(),
        roleId: String(role.id || ''),
        chatId: String(chat.id || ''),
        assistantMid,
        stream: streamEnabled,
      }

      await save()
      await api.storage.set(jobKey(jobId), job)
      await enqueueJob(jobId)
    } catch (e) {
      const msg = String(e?.message || e || '请求失败')
      const items = Array.isArray(chat?.messages) ? chat.messages : []
      const am = assistantMid ? items.find((m) => String(m?.id || '') === assistantMid) : null
      if (am) {
        am.content = `（请求失败：${msg}）`
        am.pending = false
        am.streaming = false
      }
      save().catch(() => {})
      api.ui?.showToast?.(msg)
    } finally {
      state.sending = false
      render()
    }
  }

  async function stopSending() {
    if (state.loading) return

    const roleId = String(activeRole()?.id || '')
    const chatId = String(activeChatFromData()?.id || '')
    if (!state.data || !roleId || !chatId) return

    const chat = findChatByIds(roleId, chatId)
    if (!chat) return

    const lastPending = findLastPendingAssistant(chat)
    const mid = String(lastPending?.id || '')
    if (!mid) return api.ui?.showToast?.('当前会话没有正在生成的消息')

    try {
      await api.storage.set(cancelMidKey(mid), { requestedAt: now() })
    } catch (_) {}

    if (state.data && roleId && chatId && mid) {
      let text = ''
      try {
        const s = await api.storage.get(streamKey(mid))
        text = String(s?.text || '')
      } catch (_) {}
      const finalOut = text || '（已停止）'

      const msgs = Array.isArray(chat?.messages) ? chat.messages : []
      const m = msgs.find((x) => String(x?.id || '') === mid) || null
      if (m) {
        m.content = finalOut
        m.pending = false
        m.streaming = false
      }
      if (chat) chat.updatedAt = now()
      emit()

      try {
        await patchAssistantMessage({ roleId, chatId, assistantMid: mid }, finalOut)
      } catch (_) {}
      try {
        await api.storage.remove(streamKey(mid))
      } catch (_) {}
    }

    state.sending = false
    emit()
  }

  async function regenerateAssistantMessage(assistantMid) {
    if (state.sending || state.loading || !state.data) return

    const role = activeRole()
    const chat = activeChatFromData()
    if (!role || !chat) return
    ensureRoleDefaults(role)

    const mid = String(assistantMid || '').trim()
    if (!mid) return

    const picked = pickChatModelRef(role, chat)
    const providerId = String(picked.providerId || '')
    const modelId = String(picked.modelId || '').trim()
    const p = getProvider(providerId)
    if (!p) return api.ui?.showToast?.('未找到该供应商')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) return api.ui?.showToast?.('请在供应商设置里配置 Base URL（http/https）')
    if (!apiKey) return api.ui?.showToast?.('请在供应商设置里配置 API Key')
    if (!modelId) {
      return api.ui?.showToast?.(picked.overridden ? '请先为“当前会话临时模型”选择模型ID' : '请在角色设置里选择模型（供应商 + 模型ID）')
    }

    try {
      state.sending = true
      renderComposer()

      const msgs = Array.isArray(chat.messages) ? chat.messages : []
      const aiIndex = msgs.findIndex((m) => String(m?.id || '') === mid)
      if (aiIndex < 0) throw new Error('未找到该消息')

      const target = msgs[aiIndex]
      if (!target || target.role !== 'assistant') throw new Error('只能重新生成 AI 回复')
      if (target.pending) throw new Error('该消息正在生成中')
      if (chatHasPendingAssistant(chat)) throw new Error('该会话正在生成中，请先停止或等待完成')

      let userIndex = -1
      for (let i = aiIndex - 1; i >= 0; i--) {
        const m = msgs[i]
        if (m && m.role === 'user') {
          userIndex = i
          break
        }
      }
      if (userIndex < 0) throw new Error('未找到对应的用户消息')

      const streamEnabled = !!state.data?.settings?.streamEnabled
      target.content = '（生成中…）'
      target.pending = true
      target.streaming = streamEnabled
      chat.updatedAt = now()

      try {
        await api.storage.remove(streamKey(mid))
      } catch (_) {}

      const jobId = uid('job')
      const job = {
        id: jobId,
        kind: 'openai.chat.completions',
        status: 'queued',
        createdAt: now(),
        roleId: String(role.id || ''),
        chatId: String(chat.id || ''),
        assistantMid: mid,
        cutoffMid: mid,
        stream: streamEnabled,
      }

      await save()
      await api.storage.set(jobKey(jobId), job)
      await enqueueJob(jobId)
    } catch (e) {
      const msg = String(e?.message || e || '请求失败')
      const items = Array.isArray(chat.messages) ? chat.messages : []
      const am = mid ? items.find((m) => String(m?.id || '') === mid) : null
      if (am) {
        am.content = `（请求失败：${msg}）`
        am.pending = false
        am.streaming = false
      }
      save().catch(() => {})
      api.ui?.showToast?.(msg)
    } finally {
      state.sending = false
      render()
    }
  }

  async function replyFromUserMessage(userMid) {
    if (state.sending || state.loading || !state.data) return

    const role = activeRole()
    const chat = activeChatFromData()
    if (!role || !chat) return
    ensureRoleDefaults(role)

    const mid = String(userMid || '').trim()
    if (!mid) return

    const picked = pickChatModelRef(role, chat)
    const providerId = String(picked.providerId || '')
    const modelId = String(picked.modelId || '').trim()
    const p = getProvider(providerId)
    if (!p) return api.ui?.showToast?.('未找到该供应商')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) return api.ui?.showToast?.('请在供应商设置里配置 Base URL（http/https）')
    if (!apiKey) return api.ui?.showToast?.('请在供应商设置里配置 API Key')
    if (!modelId) {
      return api.ui?.showToast?.(picked.overridden ? '请先为“当前会话临时模型”选择模型ID' : '请在角色设置里选择模型（供应商 + 模型ID）')
    }

    let assistantMid = ''
    try {
      state.sending = true
      renderComposer()

      const msgs = Array.isArray(chat.messages) ? chat.messages : []
      const userIndex = msgs.findIndex((m) => String(m?.id || '') === mid)
      if (userIndex < 0) throw new Error('未找到该消息')

      const target = msgs[userIndex]
      if (!target || target.role !== 'user') throw new Error('只能从用户消息发起重新回复')
      if (chatHasPendingAssistant(chat)) throw new Error('该会话正在生成中，请先停止或等待完成')

      const streamEnabled = !!state.data?.settings?.streamEnabled
      assistantMid = uid('m')
      msgs.splice(userIndex + 1, 0, {
        id: assistantMid,
        role: 'assistant',
        content: '（生成中…）',
        pending: true,
        streaming: streamEnabled,
        createdAt: now(),
      })
      chat.messages = msgs
      chat.updatedAt = now()

      const jobId = uid('job')
      const job = {
        id: jobId,
        kind: 'openai.chat.completions',
        status: 'queued',
        createdAt: now(),
        roleId: String(role.id || ''),
        chatId: String(chat.id || ''),
        assistantMid,
        cutoffMid: assistantMid,
        stream: streamEnabled,
      }

      await save()
      await api.storage.set(jobKey(jobId), job)
      await enqueueJob(jobId)
    } catch (e) {
      const msg = String(e?.message || e || '请求失败')
      const items = Array.isArray(chat?.messages) ? chat.messages : []
      const am = assistantMid ? items.find((m) => String(m?.id || '') === assistantMid) : null
      if (am) {
        am.content = `（请求失败：${msg}）`
        am.pending = false
        am.streaming = false
      }
      save().catch(() => {})
      api.ui?.showToast?.(msg)
    } finally {
      state.sending = false
      render()
    }
  }

  async function deleteMessage(messageId) {
    if (state.loading || !state.data) return
    if (state.sending) return api.ui?.showToast?.('操作中，请稍后重试')

    const mid = String(messageId || '').trim()
    if (!mid) return

    const role = activeRole()
    if (!role) return

    const rid = String(role.id || '')
    const pendingChat = state.pendingChat && String(state.pendingChat.roleId || '') === rid ? state.pendingChat.chat : null
    const chat = pendingChat || activeChatFromData()
    if (!chat) return
    if (chatHasPendingAssistant(chat)) return api.ui?.showToast?.('该会话正在生成中，无法删除消息')

    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const idx = msgs.findIndex((m) => String(m?.id || '') === mid)
    if (idx < 0) return api.ui?.showToast?.('未找到该消息')

    const target = msgs[idx]
    if (!target) return api.ui?.showToast?.('未找到该消息')

    if (target.role === 'assistant') {
      if (target.pending) return api.ui?.showToast?.('该消息正在生成中，无法删除')
    }

    msgs.splice(idx, 1)
    chat.updatedAt = now()

    if (target.role === 'assistant') {
      try {
        uiStreamCache.delete(mid)
      } catch (_) {}
      try {
        await api.storage.remove(streamKey(mid))
      } catch (_) {}
    }

    emit()
    if (!pendingChat) save().catch(() => {})
    api.ui?.showToast?.('已删除')
  }

  async function editMessage(messageId, content) {
    if (state.loading || !state.data) return
    if (state.sending) return api.ui?.showToast?.('操作中，请稍后重试')

    const mid = String(messageId || '').trim()
    if (!mid) return

    const role = activeRole()
    if (!role) return

    const rid = String(role.id || '')
    const pendingChat = state.pendingChat && String(state.pendingChat.roleId || '') === rid ? state.pendingChat.chat : null
    const chat = pendingChat || activeChatFromData()
    if (!chat) return
    if (chatHasPendingAssistant(chat)) return api.ui?.showToast?.('该会话正在生成中，无法编辑消息')

    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const target = msgs.find((m) => String(m?.id || '') === mid)
    if (!target) return api.ui?.showToast?.('未找到该消息')

    if (target.role === 'assistant') {
      if (target.pending) return api.ui?.showToast?.('该消息正在生成中，无法编辑')
      try {
        uiStreamCache.delete(mid)
      } catch (_) {}
    }

    target.content = String(content ?? '')
    chat.updatedAt = now()

    emit()

    if (pendingChat) return api.ui?.showToast?.('已保存')

    try {
      await save()
      api.ui?.showToast?.('已保存')
    } catch (e) {
      api.ui?.showToast?.(String(e?.message || e || '保存失败'))
    }
  }


  async function patchAssistantMessage(job, content) {
    const roleId = String(job?.roleId || '')
    const chatId = String(job?.chatId || '')
    const mid = String(job?.assistantMid || '')
    if (!roleId || !chatId || !mid) return

    const meta = await loadSplitMeta()
    if (!meta) return

    const folder = String(meta.roleFolders?.[roleId] || '')
    if (!folder) return
    const key = splitChatKey(folder, chatId)
    const raw = await api.storage.get(key)
    const chat = raw && typeof raw === 'object' ? raw : null
    if (!chat) return

    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const m = msgs.find((x) => String(x?.id) === mid)
    if (!m) return

    m.content = String(content || '')
    m.pending = false
    m.streaming = false
    chat.updatedAt = now()

    await api.storage.set(key, chat)

    try {
      const idx = meta.chatIndexByRole?.[roleId]
      if (idx && typeof idx === 'object') {
        if (!idx.chatUpdatedAt || typeof idx.chatUpdatedAt !== 'object') idx.chatUpdatedAt = {}
        idx.chatUpdatedAt[String(chatId)] = Number(chat.updatedAt || 0)
        meta.updatedAt = now()
        await api.storage.set(SPLIT_META_KEY, meta)
        splitMetaCache = meta
      }
    } catch (_) {}
  }

  async function backgroundMain() {
    const runningJobs = new Map()
    let ticking = false

    const tick = async () => {
      if (ticking) return
      ticking = true
      try {
        const q = await readJobQueue()
        if (!q.length) return

        const runningChatKeys = new Set()
        for (const v of Array.from(runningJobs.values())) {
          const k = v && typeof v === 'object' ? String(v.chatKey || '') : ''
          if (k) runningChatKeys.add(k)
        }

        for (const id0 of q.slice(0, 200)) {
          const jobId = String(id0 || '')
          if (!jobId || runningJobs.has(jobId)) continue

          const j = await api.storage.get(jobKey(jobId))
          const job = j && typeof j === 'object' ? j : null
          if (!job) {
            await dequeueJob(jobId)
            continue
          }
          if (String(job.status || '') !== 'queued') {
            await dequeueJob(jobId)
            continue
          }

          const roleId = String(job.roleId || '')
          const chatId = String(job.chatId || '')
          if (!roleId || !chatId) {
            await dequeueJob(jobId)
            continue
          }
          const chatKey = `${roleId}/${chatId}`
          if (runningChatKeys.has(chatKey)) continue
          runningChatKeys.add(chatKey)

          job.status = 'running'
          job.startedAt = now()
          await api.storage.set(jobKey(job.id), job)

          runningJobs.set(jobId, { chatKey })
          runBackgroundJob(job)
            .catch(() => {})
            .finally(async () => {
              try {
                await dequeueJob(jobId)
              } catch (_) {}
              runningJobs.delete(jobId)
            })
        }

      } catch (_) {
      } finally {
        ticking = false
      }
    }

    await tick()
    setInterval(() => {
      tick().catch(() => {})
    }, 800)
  }

  async function buildOpenAiChatReqFromStorage(job) {
    const roleId = String(job?.roleId || '')
    const chatId = String(job?.chatId || '')
    if (!roleId || !chatId) throw new Error('job 缺少 roleId/chatId')

    const meta = await loadSplitMeta()
    if (!meta) throw new Error('存储未初始化')

    const folder = String(meta.roleFolders?.[roleId] || '')
    if (!folder) throw new Error('角色不存在')

    const r0 = await api.storage.get(splitRoleKey(folder))
    const role = r0 && typeof r0 === 'object' ? r0 : null
    if (!role) throw new Error('角色不存在')

    const d = normalizeData({
      version: VERSION,
      settings: meta.settings && typeof meta.settings === 'object' ? meta.settings : {},
      roles: [role],
      chatsByRole: {},
      ui: meta.ui && typeof meta.ui === 'object' ? meta.ui : {},
    })

    const c0 = await api.storage.get(splitChatKey(folder, chatId))
    const chat = c0 && typeof c0 === 'object' ? c0 : null
    if (!chat) throw new Error('会话不存在')

    d.chatsByRole[String(roleId)] = { activeChatId: String(chatId), chats: [chat] }

    const fallbackPid = String(d?.settings?.providers?.[0]?.id || '')
    if (!role.modelRef || typeof role.modelRef !== 'object') role.modelRef = { providerId: fallbackPid, modelId: '' }
    if (!role.modelRef.providerId) role.modelRef.providerId = fallbackPid
    if (typeof role.modelRef.modelId !== 'string') role.modelRef.modelId = ''

    const providers = Array.isArray(d?.settings?.providers) ? d.settings.providers : []

    let providerId = String(role.modelRef?.providerId || '')
    let modelId = String(role.modelRef?.modelId || '').trim()
    const o = normalizeChatModelOverride(chat)
    if (o) {
      const p0 = providers.find((x) => String(x?.id || '') === o.providerId) || null
      if (p0) {
        providerId = o.providerId
        modelId = o.modelId
      }
    }

    const p = providers.find((x) => String(x?.id || '') === providerId) || null
    if (!p) throw new Error('供应商不存在')

    const baseUrl = trimSlash(p.baseUrl || '')
    const apiKey = String(p.apiKey || '').trim()
    if (!isHttpBaseUrl(baseUrl)) throw new Error('Base URL 无效（需 http/https）')
    if (!apiKey) throw new Error('API Key 为空')
    if (!modelId) throw new Error('模型ID 为空')

    const cutoffMid = String(job?.cutoffMid || '').trim()
    const msgs0 = Array.isArray(chat.messages) ? chat.messages : []
    let baseMsgs0 = msgs0
    if (cutoffMid) {
      const idx = msgs0.findIndex((m) => String(m?.id || '') === cutoffMid)
      if (idx >= 0) baseMsgs0 = msgs0.slice(0, idx)
    }
    const msgs = baseMsgs0.filter((m) => !(m && m.role === 'assistant' && m.pending))
    const history = limitHistory(msgs, 40)

    const sys = String(role.systemPrompt || '').trim()
    const messages = []
    if (sys) messages.push({ role: 'system', content: sys })

    for (const m of history) {
      const r = m?.role === 'assistant' ? 'assistant' : 'user'
      const text = String(m?.content || '')
      if (r === 'user') {
        const paths = normImagePaths(m?.images)
        if (paths.length) {
          if (typeof api?.files?.images?.read !== 'function') throw new Error('未授权：files.images.read')
          const parts = [{ type: 'text', text }]
          for (const path of paths) {
            let dataUrl = ''
            try {
              dataUrl = await api.files.images.read({ scope: 'data', path })
            } catch (e) {
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

  async function runBackgroundJob(job) {
    const streamWanted = !!job?.stream
    let req = job?.req || null
    const mid = String(job?.assistantMid || '')
    if (!req || typeof req !== 'object') {
      if (String(job?.kind || '') === 'openai.chat.completions') {
        req = await buildOpenAiChatReqFromStorage(job)
      }
    }
    if (!req || typeof req !== 'object') throw new Error('job.req 无效')

    let out = ''
    let status = 0
    let bad = false
    let badBody = ''
    let lastFlush = 0
    let canceled = false
    let lastCancelCheck = 0

    const checkCanceled = async (force) => {
      if (canceled) return true
      const t = now()
      if (!force && t - lastCancelCheck < 250) return false
      lastCancelCheck = t
      try {
        const v1 = await api.storage.get(cancelKey(job.id))
        const v2 = mid ? await api.storage.get(cancelMidKey(mid)) : null
        if (v1 || v2) canceled = true
      } catch (_) {}
      return canceled
    }

    const flush = async (force) => {
      if (!mid) return
      const t = now()
      if (!force && t - lastFlush < 220) return
      lastFlush = t
      await api.storage.set(streamKey(mid), { text: out, updatedAt: t })
    }

    try {
      await checkCanceled(true)
      if (canceled) {
        const finalOut = out || '（已停止）'
        await flush(true)
        await patchAssistantMessage(job, finalOut)
        return
      }

      const canStream = streamWanted && typeof api?.net?.requestStream === 'function'
      if (canStream) {
        const stream = await api.net.requestStream(req)
        const sse = { buf: '', done: false }

        for await (const ev of stream) {
          await checkCanceled(false)
          if (canceled) break

          const t = String(ev?.type || '')
          if (t === 'start') {
            status = Number(ev?.status || 0)
            bad = status < 200 || status >= 300
            continue
          }
          if (t === 'chunk') {
            const text = String(ev?.text || '')
            if (!text) continue
            if (bad) {
              badBody += text
              continue
            }

            sseFeed(sse, text, (json) => {
              if (json?.error?.message) throw new Error(String(json.error.message))
              const delta = extractOpenAiDelta(json)
              if (typeof delta === 'string' && delta) out += delta
            })

            await flush(false)
            if (sse.done) break
            continue
          }
          if (t === 'error') throw new Error(String(ev?.message || '请求失败'))
          if (t === 'end') break
        }

        if (canceled) {
          const finalOut = out || '（已停止）'
          await flush(true)
          await patchAssistantMessage(job, finalOut)
          return
        }

        if (bad) {
          let msg = String(badBody || '').trim()
          try {
            const j = JSON.parse(msg || '{}')
            msg = String(j?.error?.message || msg || `HTTP ${status}`)
          } catch (_) {}
          throw new Error(msg || `HTTP ${status}`)
        }
      } else {
        await checkCanceled(true)
        if (canceled) {
          const finalOut = out || '（已停止）'
          await flush(true)
          await patchAssistantMessage(job, finalOut)
          return
        }

        const r = await api.net.request(req)
        await checkCanceled(true)
        if (canceled) {
          const finalOut = out || '（已停止）'
          await flush(true)
          await patchAssistantMessage(job, finalOut)
          return
        }

        status = Number(r?.status || 0)
        const bodyText = String(r?.body || '')
        bad = status < 200 || status >= 300

        if (streamWanted) {
          const sse = { buf: '', done: false }
          sseFeed(sse, bodyText, (json) => {
            if (json?.error?.message) throw new Error(String(json.error.message))
            const delta = extractOpenAiDelta(json)
            if (typeof delta === 'string' && delta) out += delta
          })
        } else {
          const json = JSON.parse(bodyText || '{}')
          if (bad) throw new Error(json?.error?.message || bodyText || `HTTP ${status}`)
          out = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? json?.output_text ?? ''
          out = String(out || '')
        }

        if (bad) {
          let msg = String(bodyText || '').trim()
          try {
            const j = JSON.parse(msg || '{}')
            msg = String(j?.error?.message || msg || `HTTP ${status}`)
          } catch (_) {}
          throw new Error(msg || `HTTP ${status}`)
        }
      }

      await flush(true)
      await patchAssistantMessage(job, out)
    } catch (e) {
      try {
        await checkCanceled(true)
      } catch (_) {}

      if (canceled) {
        const finalOut = out || '（已停止）'
        try {
          await flush(true)
        } catch (_) {}
        await patchAssistantMessage(job, finalOut)
      } else {
        const msg = String(e?.message || e || '请求失败')
        out = out || `（请求失败：${msg}）`
        try {
          await flush(true)
        } catch (_) {}
        await patchAssistantMessage(job, out)
      }
    } finally {
      if (mid) {
        try {
          await api.storage.remove(streamKey(mid))
        } catch (_) {}
      }
      try {
        await api.storage.remove(jobKey(job.id))
      } catch (_) {}
      try {
        await api.storage.remove(cancelKey(job.id))
      } catch (_) {}
      if (mid) {
        try {
          await api.storage.remove(cancelMidKey(mid))
        } catch (_) {}
      }
    }
  }

  const css = `
  :root{--bg:#fff;--card:#fff;--muted:#6b7280;--text:#111827;--line:#e5e7eb;--pri:#2563eb;--bad:#dc2626;--ok:#16a34a;--r:12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
  *{box-sizing:border-box;}html,body{height:100%;overflow:hidden;}body{margin:0;background:var(--bg);color:var(--text);overflow:hidden;overscroll-behavior:none;}
  .wrap{height:100vh;overflow:hidden;display:flex;flex-direction:column;}
  .top{height:48px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--line);background:#fff;}
  .title{font-weight:900;font-size:13px;letter-spacing:0.3px;margin-right:auto;}
  .btn{height:32px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--text);cursor:pointer;font-size:12px;}
  .btn.pri{border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.08);color:var(--pri);} .btn.bad{border-color:rgba(220,38,38,.25);background:rgba(220,38,38,.06);color:var(--bad);} .btn.ok{border-color:rgba(22,163,74,.25);background:rgba(22,163,74,.08);color:var(--ok);} .btn:disabled{opacity:.6;cursor:not-allowed;}
  .content{flex:1;min-height:0;display:flex;}
  .side{width:240px;border-right:1px solid var(--line);padding:10px;overflow:auto;overscroll-behavior:contain;}
  .main{flex:1;min-width:0;display:flex;flex-direction:column;}
  .role{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--line);border-radius:12px;cursor:pointer;background:#fff;}
  .role+.role{margin-top:8px;} .role[data-active="1"]{border-color:rgba(37,99,235,.35);background:rgba(37,99,235,.04);}
  .avatar{width:28px;height:28px;border-radius:10px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;background:#f9fafb;}
  .roleName{font-weight:800;font-size:12px;} .muted{color:var(--muted);font-size:12px;} .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;}
  .tabs{display:flex;gap:6px;align-items:center;} .tab{height:28px;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--text);cursor:pointer;font-size:12px;}
  .tab.on{border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.08);color:var(--pri);}
  .chatList{display:flex;flex-direction:column;gap:8px;}
  .chatItem{padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:#fff;cursor:pointer;}
  .chatItem[data-active="1"]{border-color:rgba(37,99,235,.35);background:rgba(37,99,235,.04);}
  .chatItem:hover{border-color:rgba(37,99,235,.25);background:rgba(37,99,235,.03);}
  .chatTop{display:flex;gap:8px;align-items:center;}
  .chatTitle{font-weight:900;font-size:12px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .chatTime{font-size:11px;color:var(--muted);}
  .chatText{font-size:12px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .sp{margin-left:auto;}
  .chat{flex:1;min-height:0;overflow:auto;padding:12px;background:#fafafa;overscroll-behavior:contain;}
  .composer{border-top:1px solid var(--line);padding:10px;display:flex;flex-direction:column;gap:8px;background:#fff;}
  .composeRow{display:flex;gap:8px;align-items:flex-end;}
  .draftImgs{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
  .draftImg{width:54px;height:54px;border:1px solid var(--line);border-radius:12px;position:relative;overflow:hidden;background:#fff;}
  .draftImg img{width:100%;height:100%;object-fit:cover;display:block;}
  .draftX{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.92);cursor:pointer;line-height:18px;padding:0;font-size:14px;}
  .ta{flex:1;min-height:42px;max-height:160px;resize:vertical;border:1px solid var(--line);border-radius:12px;padding:9px 10px;font-size:12px;outline:none;}
  .msg{display:flex;gap:8px;margin-bottom:10px;} .bubble{max-width:880px;border:1px solid var(--line);border-radius:12px;padding:10px;background:#fff;box-shadow:0 6px 18px rgba(17,24,39,.06);} .msg.user{justify-content:flex-end;} .msg.user .bubble{background:rgba(37,99,235,.06);border-color:rgba(37,99,235,.18);}
  .msgHead{display:flex;align-items:center;gap:8px;margin-bottom:6px;} .msgRole{font-weight:900;font-size:12px;} .msgTime{font-size:11px;color:var(--muted);margin-left:auto;} .msgActions{display:flex;gap:6px;}
  .mini{height:26px;padding:0 8px;border-radius:10px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px;}
  .msgImgs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 8px;}
  .msgImg{width:180px;height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--line);background:#fff;display:block;}
  .prose{font-size:12px;line-height:1.65;word-break:break-word;} .prose pre{overflow:auto;padding:10px;background:#0b1220;color:#e5e7eb;border-radius:10px;border:1px solid rgba(255,255,255,.08);} .prose pre.fw-code-block{position:relative;padding-top:34px;} .prose pre.fw-code-block .fw-code-copy{position:absolute;top:6px;right:6px;z-index:1;width:28px;height:28px;padding:0;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#e5e7eb;font-size:12px;cursor:pointer;user-select:none;-webkit-user-select:none;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:inline-flex;align-items:center;justify-content:center;} .prose pre.fw-code-block .fw-code-copy:hover{background:rgba(255,255,255,.12);} .prose pre.fw-code-block .fw-code-copy:active{background:rgba(255,255,255,.16);} .prose pre.fw-code-block .fw-code-copy:disabled{opacity:.75;cursor:default;} .prose pre.fw-code-block .fw-code-copy:focus-visible{outline:2px solid rgba(255,255,255,.35);outline-offset:2px;} .prose pre.fw-code-block .fw-code-copy[data-state="ok"]{color:#34d399;} .prose pre.fw-code-block .fw-code-copy[data-state="fail"]{color:#f87171;} .prose code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;}
  .prose p{margin:8px 0;} .prose ul,.prose ol{margin:8px 0 8px 18px;} .prose blockquote{margin:8px 0;padding:8px 10px;border-left:3px solid rgba(37,99,235,.35);background:rgba(37,99,235,.04);border-radius:10px;} .prose hr{border:0;border-top:1px solid var(--line);margin:10px 0;} .math-block{margin:8px 0;overflow-x:auto;}
  .prose .katex,.prose .katex-display{max-width:100%;}
  .prose span.katex{display:inline-block;overflow:visible;vertical-align:middle;}
  .prose .katex-display{overflow:visible;}
  .prose .katex-display>.katex{display:block;overflow-x:visible;}
  .fw-math-host{position:relative;}
  .math-inline.fw-math-host{display:inline-block;}
  .math-block.fw-math-host{display:block;}
  .fw-math-copy{position:absolute;width:24px;height:24px;padding:0;border-radius:999px;border:1px solid transparent;background:transparent;color:rgba(0,0,0,.55);cursor:pointer;user-select:none;-webkit-user-select:none;display:inline-flex;align-items:center;justify-content:center;font-size:12px;line-height:1;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 120ms ease;}
  .fw-math-copy:hover{background:rgba(0,0,0,.06);border-color:rgba(0,0,0,.12);color:rgba(0,0,0,.72);}
  .fw-math-copy:active{background:rgba(0,0,0,.10);border-color:rgba(0,0,0,.12);color:rgba(0,0,0,.76);}
  .fw-math-copy:focus-visible{outline:2px solid rgba(37,99,235,.35);outline-offset:2px;}
  .math-inline.fw-math-host>.fw-math-copy{left:100%;top:50%;transform:translate(6px,-50%);}
  .math-block.fw-math-host>.fw-math-copy{right:6px;top:50%;transform:translateY(-50%);}
  .fw-math-host:hover>.fw-math-copy,.fw-math-host:focus-within>.fw-math-copy{opacity:1;visibility:visible;pointer-events:auto;}
  .mermaid-block{margin:8px 0;overflow-x:auto;cursor:zoom-in;}
  .mermaid-block svg{max-width:100%;height:auto;display:block;}
  .modal.mm{width:min(1100px,100%);height:640px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:hidden;}
  .mmStage{margin-top:10px;flex:1;min-height:0;overflow:auto;border:1px solid var(--line);border-radius:12px;background:#fff;padding:10px;}
  .mmStage[data-mm-drag="1"]{cursor:grabbing;}
  .mmCanvas{display:inline-block;transform-origin:0 0;}
  .overlay{position:fixed;inset:0;background:rgba(17,24,39,.18);display:flex;align-items:center;justify-content:center;padding:12px;}
  .modal{width:min(760px,100%);max-height:calc(100vh - 24px);overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;box-shadow:0 10px 30px rgba(17,24,39,.12);}
  .card{border:1px solid var(--line);border-radius:12px;padding:10px;background:#fff;} .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;} .hr{height:1px;background:var(--line);margin:10px 0;}
  .field{width:100%;border:1px solid var(--line);background:#fff;color:var(--text);border-radius:10px;padding:9px 10px;font-size:12px;outline:none;} .field.sm{width:auto;min-width:180px;}
  `

  function mount() {
    // legacy DOM UI 已弃用（改为 React+MUI）
  }

  function fmtTime(ts) {
    try {
      const t = Number(ts || 0)
      if (!isFinite(t) || t <= 0) return ''

      const d = new Date(t)
      const nowD = new Date()

      const pad2 = (n) => String(n).padStart(2, '0')
      const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`

      const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const diffDays = Math.floor((startOfDay(nowD) - startOfDay(d)) / 86400000)

      if (diffDays === 0) return hm
      if (diffDays === 1) return `昨天 ${hm}`
      if (diffDays === 2) return `前天 ${hm}`

      return `${d.getFullYear()}年${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日 ${hm}`
    } catch (_) {
      return ''
    }
  }

  function renderTop() {
    emit()
    return
    const el = document.querySelector('[data-area="top"]')
    if (!(el instanceof HTMLElement)) return
    const on = !!state.data?.settings?.streamEnabled
    el.innerHTML = `
      <div class="title">AI 聊天</div>
      <button class="btn ${on ? 'ok' : ''}" data-act="toggle-stream">${on ? '流式：开' : '流式：关'}</button>
      <button class="btn" data-act="open-providers">供应商</button>
      <button class="btn pri" data-act="new-role">新角色</button>
      <button class="btn pri" data-act="new-chat">新建聊天</button>
      <button class="btn" data-act="edit-role">角色设置</button>
    `
  }

  function renderSide() {
    emit()
    return
    const el = document.querySelector('[data-area="side"]')
    if (!(el instanceof HTMLElement)) return
    if (state.loading) return (el.innerHTML = `<div class="muted">加载中…</div>`)

    const roles = state.data?.roles || []
    const active = String(state.draft.activeRoleId || '')
    const tab = state.sideTab === 'chats' ? 'chats' : 'roles'

    function tabBtn(name, label) {
      const on = tab === name ? ' on' : ''
      return `<button class="tab${on}" data-act="side-tab" data-tab="${esc(name)}">${esc(label)}</button>`
    }

    function renderRoles() {
      return roles
        .map((r) => {
          const on = String(r.id) === active ? '1' : '0'
          return `
          <div class="role" data-act="pick-role" data-id="${esc(r.id)}" data-active="${on}">
            <div class="avatar">${esc(r.avatar || '🙂')}</div>
            <div style="min-width:0">
              <div class="roleName">${esc(r.name || '')}</div>
              <div class="muted">${esc(String(r.modelRef?.providerId || ''))} / ${esc(String(r.modelRef?.modelId || ''))}</div>
            </div>
            <div class="sp"></div>
            <button class="mini" data-act="edit-role-inline" data-id="${esc(r.id)}">设置</button>
          </div>
        `
        })
        .join('')
    }

    function renderChats() {
      const role = activeRole()
      if (!role || !state.data) return `<div class="muted">请选择角色</div>`
      const box = state.data.chatsByRole?.[String(role.id)]
      const chats = Array.isArray(box?.chats) ? box.chats : []
      const activeChatId = String(box?.activeChatId || '')
      if (!chats.length) return `<div class="muted">暂无会话</div>`

      const list = chats
        .slice()
        .sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
        .map((c) => {
          const on = String(c.id) === activeChatId ? '1' : '0'
          const msgs = Array.isArray(c.messages) ? c.messages : []
          const last = msgs.length ? msgs[msgs.length - 1] : null
          const who = last?.role === 'user' ? '你' : String(role.avatar || '🤖')
          const raw = String(last?.content || '').replace(/\s+/g, ' ').trim()
          const snippet = raw.length > 40 ? raw.slice(0, 40) + '…' : raw
          const hasImg = Array.isArray(last?.images) && last.images.length > 0
          const time = fmtTime(c.updatedAt || c.createdAt)
          return `
            <div class="chatItem" data-act="pick-chat" data-id="${esc(c.id)}" data-active="${on}">
              <div class="chatTop">
                <div class="chatTitle">${esc(String(c.title || '新聊天'))}</div>
                <div class="sp"></div>
                <div class="chatTime">${esc(time)}</div>
              </div>
              <div class="chatText">${esc(who)}：${esc(snippet || (hasImg ? '(图片)' : '(空)'))}</div>
            </div>
          `
        })
        .join('')

      return `<div class="chatList">${list}</div>`
    }

    el.innerHTML = `
      <div class="row" style="margin-bottom:10px">
        <div class="tabs">
          ${tabBtn('roles', '角色')}
          ${tabBtn('chats', '记录')}
        </div>
        <div class="sp"></div>
      </div>
      ${tab === 'roles' ? renderRoles() : renderChats()}
    `
  }

  function renderChat() {
    emit()
    return
    const el = document.querySelector('[data-area="chat"]')
    if (!(el instanceof HTMLElement)) return
    if (state.loading) return (el.innerHTML = `<div class="muted">加载中…</div>`)

    const role = activeRole()
    const chat = activeChat()
    if (!role || !chat) return (el.innerHTML = `<div class="muted">请选择角色</div>`)

    const items = Array.isArray(chat.messages) ? chat.messages : []
    if (!items.length) return (el.innerHTML = `<div class="muted">还没有消息。输入内容并发送。</div>`)

    el.innerHTML = items
      .map((m) => {
        const isUser = m.role === 'user'
        const who = isUser ? '你' : `${String(role.avatar || '🤖')} ${String(role.name || 'AI')}`
        const time = fmtTime(m.createdAt)
        const imgPaths = isUser ? normImagePaths(m.images) : []
        const imgs =
          imgPaths.length > 0
            ? `<div class="msgImgs">
              ${imgPaths
                .map((p) => {
                  const cached = uiRefImgCache.get(p)
                  const src = typeof cached === 'string' && cached ? cached : REF_IMG_PLACEHOLDER
                  return `<img class="msgImg" data-ref-img="${esc(p)}" src="${esc(src)}" alt="图片" />`
                })
                .join('')}
            </div>`
            : ''

        const text = String(m.content || '')
        const textHtml = text ? `<div class="prose">${esc(text).replace(/\n/g, '<br />')}</div>` : ''

        const body = isUser ? `${imgs}${textHtml}` : `<div class="prose" data-render-assistant="1" data-mid="${esc(m.id)}"></div>`
        const actions = isUser
          ? ''
          : `<div class="msgActions"><button class="mini" data-act="copy-msg" data-id="${esc(m.id)}">复制</button></div>`

        return `
          <div class="msg ${isUser ? 'user' : 'assistant'}" data-mid="${esc(m.id)}">
            <div class="bubble">
              <div class="msgHead">
                <div class="msgRole">${esc(who)}</div>
                <div class="msgTime">${esc(time)}</div>
                ${actions}
              </div>
              ${body}
            </div>
          </div>
        `
      })
      .join('')

    const holders = Array.from(el.querySelectorAll('[data-render-assistant="1"]'))
    for (const h of holders) {
      if (!(h instanceof HTMLElement)) continue
      const mid = String(h.getAttribute('data-mid') || '')
      const msg = items.find((x) => String(x?.id) === mid)
      let content = String(msg?.content || '')
      if (msg?.pending && msg?.streaming) {
        const cached = uiStreamCache.get(mid)
        if (typeof cached === 'string' && cached) content = cached
      }
      renderAssistantInto(h, content)
    }

    hydrateRefImages(el)
  }

  function hydrateRefImages(root) {
    if (!(root instanceof HTMLElement)) return
    if (typeof api?.files?.images?.read !== 'function') return

    const els = Array.from(root.querySelectorAll('[data-ref-img]'))
    const byPath = new Map()

    for (const el of els) {
      if (!(el instanceof HTMLImageElement)) continue
      const path = String(el.getAttribute('data-ref-img') || '').trim()
      if (!path) continue

      const cached = uiRefImgCache.get(path)
      if (typeof cached === 'string' && cached) {
        el.src = cached
        continue
      }

      if (!byPath.has(path)) byPath.set(path, [])
      byPath.get(path).push(el)
    }

    for (const [path, list] of byPath) {
      if (uiRefImgPending.has(path)) continue
      uiRefImgPending.add(path)
      api.files
        .images.read({ scope: 'data', path })
        .then((dataUrl) => {
          const ok = typeof dataUrl === 'string' && dataUrl.startsWith('data:')
          if (ok) uiRefImgCache.set(path, dataUrl)
          const src = ok ? dataUrl : REF_IMG_PLACEHOLDER
          for (const img of list) {
            if (!(img instanceof HTMLImageElement)) continue
            if (!img.isConnected) continue
            img.src = src
          }
        })
        .catch(() => {})
        .finally(() => {
          uiRefImgPending.delete(path)
        })
    }
  }

  function renderComposer() {
    emit()
    return
    const el = document.querySelector('[data-area="composer"]')
    if (!(el instanceof HTMLElement)) return
    const disabled = state.loading || state.sending || !activeRole()
    const draftImages = Array.isArray(state.draft.images) ? state.draft.images : []
    const canPickImages = !disabled && api?.files?.pickImages
    const imgsHtml = draftImages.length
      ? `<div class="draftImgs">
        ${draftImages
          .map((img) => {
            const src = typeof img?.dataUrl === 'string' ? img.dataUrl : ''
            const id = String(img?.id || '')
            const name = String(img?.name || '图片')
            if (!src || !id) return ''
            return `
              <div class="draftImg">
                <img src="${esc(src)}" alt="${esc(name)}" />
                <button class="draftX" data-act="rm-draft-img" data-id="${esc(id)}" title="移除">×</button>
              </div>
            `
          })
          .join('')}
      </div>`
      : ''
    el.innerHTML = `
      ${imgsHtml}
      <div class="composeRow">
        <button class="btn" data-act="pick-images" ${canPickImages ? '' : 'disabled'} title="选择图片">图片</button>
        <textarea class="ta" data-bind="input" placeholder="输入消息…（Enter 发送 / Shift+Enter 换行；支持粘贴图片）" ${disabled ? 'disabled' : ''}>${esc(
          state.draft.input || '',
        )}</textarea>
        <button class="btn pri" data-act="send" ${disabled ? 'disabled' : ''}>${state.sending ? '发送中…' : '发送'}</button>
      </div>
    `
  }

  function renderModal() {
    emit()
    return
    const el = document.querySelector('[data-area="modal"]')
    if (!(el instanceof HTMLElement)) return
    if (!state.modal) return (el.innerHTML = '')

    if (state.modal === 'mermaid') {
      const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
      const idx = len ? clamp(state.mermaid.index, 0, len - 1) : 0
      const scale = clamp(state.mermaid.scale, 0.2, 6)
      const svg = len ? String(state.mermaid.items[idx]?.svg || '') : ''

      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal mm" data-stop="1" data-mm-modal="1">
            <div class="row">
              <div class="title" style="margin:0">Mermaid 预览 <span class="muted" data-mm-label="1">${len ? `${idx + 1}/${len}` : ''}</span></div>
              <div class="sp"></div>
              <button class="btn" data-act="mm-prev" title="上一张" ${len <= 1 ? 'disabled' : ''}>←</button>
              <button class="btn" data-act="mm-next" title="下一张" ${len <= 1 ? 'disabled' : ''}>→</button>
              <button class="btn" data-act="mm-zoom-out" title="缩小">－</button>
              <div class="muted" data-mm-zoom="1" style="min-width:54px;text-align:center">${Math.round(scale * 100)}%</div>
              <button class="btn" data-act="mm-zoom-in" title="放大">＋</button>
              <button class="btn" data-act="mm-reset" title="重置缩放">重置</button>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="mmStage" data-mm-stage="1">
              <div class="mmCanvas" data-mm-canvas="1" style="transform:scale(${scale})">${svg || '<div class="muted">无可预览的 Mermaid</div>'}</div>
            </div>
          </div>
        </div>
      `
      return
    }

    if (state.modal === 'role') {
      const role = state.data?.roles.find((r) => String(r?.id) === String(state.draft.editRoleId || ''))
      const ps = state.data?.settings?.providers || []
      const pick = String(state.draft.roleModelId || '')
      const showCustom = pick === '__custom__'

      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal" data-stop="1">
            <div class="row">
              <div class="title" style="margin:0">角色设置：${esc(role?.name || '')}</div>
              <div class="sp"></div>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <div class="card">
              <div class="muted">名称</div>
              <input class="field" data-bind="roleName" value="${esc(state.draft.roleName || '')}" />
              <div class="hr"></div>
              <div class="muted">头像（emoji / 文本）</div>
              <input class="field" data-bind="roleAvatar" value="${esc(state.draft.roleAvatar || '')}" />
              <div class="hr"></div>
              <div class="muted">System Prompt</div>
              <textarea class="field mono" data-bind="roleSystemPrompt" style="min-height:140px" placeholder="写入系统提示词…">${esc(
                state.draft.roleSystemPrompt || '',
              )}</textarea>
              <div class="hr"></div>
              <div class="row">
                <div style="min-width:220px">
                  <div class="muted">供应商（providerId）</div>
                  <select class="field sm" data-bind="roleProviderId">
                    ${ps
                      .map(
                        (p) =>
                          `<option value="${esc(p.id)}"${String(p.id) === String(state.draft.roleProviderId || '') ? ' selected' : ''}>${esc(
                            p.name,
                          )} (${esc(p.id)})</option>`,
                      )
                      .join('')}
                  </select>
                </div>
                <div style="min-width:280px">
                  <div class="muted">模型ID</div>
                  <select class="field sm" data-bind="roleModelId">
                    <option value="">（未选择）</option>
                    ${state.models.items
                      .map((id) => `<option value="${esc(id)}"${id === pick ? ' selected' : ''}>${esc(id)}</option>`)
                      .join('')}
                    <option value="__custom__"${showCustom ? ' selected' : ''}>自定义…</option>
                  </select>
                </div>
                <div class="sp"></div>
                <button class="btn" data-act="refresh-models" ${state.models.loading ? 'disabled' : ''}>${state.models.loading ? '刷新中…' : '刷新模型'}</button>
              </div>
              ${state.models.error ? `<div class="muted" style="margin-top:8px;color:var(--bad)">${esc(state.models.error)}</div>` : ''}
              ${
                showCustom
                  ? `<div style="margin-top:10px">
                      <div class="muted">自定义模型ID</div>
                      <input class="field mono" data-bind="roleCustomModelId" placeholder="例如：gpt-4.1-mini" value="${esc(
                        state.draft.roleCustomModelId || '',
                      )}" />
                    </div>`
                  : ''
              }
              <div class="hr"></div>
              <div class="row">
                <div style="min-width:260px">
                  <div class="muted">温度（0~2）</div>
                  <input class="field sm mono" data-bind="roleTemperature" value="${esc(String(state.draft.roleTemperature || '0.7'))}" />
                </div>
                <div class="sp"></div>
                <button class="btn ok" data-act="save-role">保存</button>
                <button class="btn bad" data-act="ask-delete-role" data-id="${esc(role?.id || '')}">删除角色</button>
              </div>
            </div>
          </div>
        </div>
      `
      return
    }

    if (state.modal === 'providers') {
      const ps = state.data?.settings?.providers || []
      const editing = String(state.draft.editProviderId || '')

      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal" data-stop="1">
            <div class="row">
              <div class="title" style="margin:0">供应商</div>
              <div class="sp"></div>
              <button class="btn" data-act="new-provider">新建</button>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${ps
                .map((p) => {
                  const isEditing = String(p.id) === editing
                  return `
                    <div class="card">
                      <div class="row">
                        <div style="font-weight:900;font-size:12px">${esc(p.name || '')}</div>
                        <div class="muted mono">${esc(p.id)}</div>
                        <div class="sp"></div>
                        <button class="btn" data-act="edit-provider" data-id="${esc(p.id)}">${isEditing ? '收起' : '编辑'}</button>
                        <button class="btn bad" data-act="ask-delete-provider" data-id="${esc(p.id)}">删除</button>
                      </div>
                      ${
                        isEditing
                          ? `
                          <div class="hr"></div>
                          <div class="muted">名称</div>
                          <input class="field" data-bind="providerName" value="${esc(state.draft.providerName || '')}" />
                          <div class="hr"></div>
                          <div class="muted">Base URL（OpenAI 兼容）</div>
                          <input class="field mono" data-bind="providerBaseUrl" placeholder="https://api.openai.com/v1" value="${esc(String(state.draft.providerBaseUrl || ''))}" />
                          <div class="hr"></div>
                          <div class="muted">API Key</div>
                          <input class="field mono" data-bind="providerApiKey" placeholder="sk-..." value="${esc(String(state.draft.providerApiKey || ''))}" />
                          <div class="hr"></div>
                          <div class="row">
                            <button class="btn ok" data-act="save-provider">保存</button>
                            <button class="btn" data-act="close-provider-editor">收起</button>
                          </div>
                        `
                          : ''
                      }
                    </div>
                  `
                })
                .join('')}
            </div>
          </div>
        </div>
      `
      return
    }

    if (state.modal === 'confirm') {
      const delRoleId = String(state.draft.deleteRoleId || '')
      const delProviderId = String(state.draft.deleteProviderId || '')
      const msg = delRoleId ? '确认删除该角色？（聊天记录也会删除）' : delProviderId ? '确认删除该供应商？' : ''

      el.innerHTML = `
        <div class="overlay" data-act="close-modal">
          <div class="modal" data-stop="1" style="max-width:520px">
            <div class="row">
              <div class="title" style="margin:0">确认</div>
              <div class="sp"></div>
              <button class="btn" data-act="close-modal">关闭</button>
            </div>
            <div class="hr"></div>
            <div class="muted">${esc(msg)}</div>
            <div class="hr"></div>
            <div class="row">
              <div class="sp"></div>
              <button class="btn bad" data-act="confirm-delete">删除</button>
            </div>
          </div>
        </div>
      `
      return
    }

    el.innerHTML = ''
  }

  function render() {
    emit()
  }

  function scrollToBottomSoon() {
    // UI 负责滚动逻辑（React）
  }

  let uiPollTimer = 0
  let uiLastSyncMs = 0
  const uiStreamCache = new Map()

  function reapplyUiStreamCache(chatOverride) {
    const chat = chatOverride || activeChatFromData()
    if (!chat) return false
    const items = Array.isArray(chat.messages) ? chat.messages : []
    let changed = false
    for (const m of items.slice(-30)) {
      if (!m || !m.pending || !m.streaming) continue
      const mid = String(m.id || '')
      const cached = uiStreamCache.get(mid)
      if (typeof cached !== 'string' || !cached) continue
      if (String(m.content || '') === cached) continue
      m.content = cached
      changed = true
    }
    return changed
  }

  function findChatByIds(roleId, chatId) {
    if (!state.data) return null
    const rid = String(roleId || '')
    const cid = String(chatId || '')
    if (!rid || !cid) return null
    const box = state.data.chatsByRole?.[rid]
    const chats = Array.isArray(box?.chats) ? box.chats : []
    return chats.find((c) => String(c?.id || '') === cid) || null
  }

  function startUiPollers() {
    if (uiPollTimer) return
    uiPollTimer = window.setInterval(() => {
      uiPollTick().catch(() => {})
    }, 350)
  }

  async function syncDataFromStorage() {
    const keepActive = String(state.draft.activeRoleId || '')
    const keepInput = String(state.draft.input || '')
    const keepImages = Array.isArray(state.draft.images) ? state.draft.images : []
    const split = await loadSplitData()
    if (!split) return
    state.data = split
    if (keepActive) state.draft.activeRoleId = keepActive
    else state.draft.activeRoleId = String(state.data?.ui?.activeRoleId || '')
    state.draft.input = keepInput
    state.draft.images = keepImages
  }

  async function uiPollTick() {
    if (state.loading || !state.data) return

    let chat = activeChatFromData()
    if (!chat) return

    const items = Array.isArray(chat.messages) ? chat.messages : []
    const pending = items.filter((m) => m && m.role === 'assistant' && m.pending).slice(-3)

    if (pending.length) {
      let changed = false
      for (const m of pending) {
        if (!m.streaming) continue
        const s = await api.storage.get(streamKey(String(m.id || '')))
        const text = String(s?.text || '')
        if (!text) continue
        const mid = String(m.id || '')
        if (uiStreamCache.get(mid) === text) continue
        uiStreamCache.set(mid, text)
        m.content = text
        changed = true
      }
      if (changed) emit()

      const t = now()
      if (t - uiLastSyncMs > 900) {
        uiLastSyncMs = t
        // 避免把“本地尚未落盘”的 UI 状态（尤其是新建会话 + 首条消息发送中）用磁盘快照覆盖掉。
        // 否则会出现：新会话刚创建/刚写入前，被轮询同步回旧会话，表现为“回退到上一个会话但消息已发送”。
        if (state.sending || state.pendingChat) return
        await syncDataFromStorage()
        chat = activeChatFromData()
        reapplyUiStreamCache(chat)
        emit()
      }

      return
    }

    uiStreamCache.clear()

    if (state.sending) {
      state.sending = false
      emit()
    }
  }

  async function pickRoleAvatarImage() {
    if (state.loading) return
    if (typeof api?.files?.pickImages !== 'function') return api.ui?.showToast?.('未授权：files.pickImages')

    try {
      const items = await api.files.pickImages(1)
      const list = Array.isArray(items) ? items : []
      const it = list.length ? list[0] : null
      const u0 = String(it?.dataUrl || '')
      if (!looksLikeImageDataUrl(u0)) return api.ui?.showToast?.('未选择图片')

      const shrunk = await shrinkImageDataUrl(u0, 1024)
      const u = shrunk || u0
      if (!looksLikeImageDataUrl(u)) return api.ui?.showToast?.('头像图片无效')

      state.draft.roleAvatarImageCropSrc = u
      render()
    } catch (e) {
      api.ui?.showToast?.(String(e?.message || e || '选择头像失败'))
    }
  }

  function clearRoleAvatarImage() {
    state.draft.roleAvatarImage = ''
    state.draft.roleAvatarImageCropSrc = ''
    render()
  }

  function closeModal() {
    cancelMermaidDrag()
    state.modal = ''
    state.draft.deleteRoleId = ''
    state.draft.deleteProviderId = ''
    state.draft.roleAvatarImageCropSrc = ''
    if (String(state.draft.editRoleId || '') === NEW_ROLE_ID) {
      state.draft.editRoleId = ''
      state.draft.roleName = ''
      state.draft.roleAvatar = ''
      state.draft.roleAvatarImage = ''
      state.draft.roleAvatarImageCropSrc = ''
      state.draft.roleSystemPrompt = ''
      state.draft.roleProviderId = ''
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      state.draft.roleTemperature = '0.7'
    }
    render()
  }

  function openNewRoleEditor() {
    if (!state.data) return
    const fallbackPid = String(state.data.settings.providers?.[0]?.id || '')

    state.draft.editRoleId = NEW_ROLE_ID
    state.draft.roleName = '新角色'
    state.draft.roleAvatar = '🙂'
    state.draft.roleAvatarImage = ''
    state.draft.roleAvatarImageCropSrc = ''
    state.draft.roleSystemPrompt = ''
    state.draft.roleTemperature = '0.7'
    state.draft.roleProviderId = fallbackPid

    const p = getProvider(fallbackPid)
    const cachedItems = Array.isArray(p?.modelsCache?.items) ? p.modelsCache.items : []
    state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }
    state.draft.roleModelId = ''
    state.draft.roleCustomModelId = ''

    state.modal = 'role'
    render()
  }

  function createRole() {
    openNewRoleEditor()
  }

  function openRoleEditor(roleId) {
    if (!state.data) return
    const rid = String(roleId || '')
    const role = state.data.roles.find((r) => String(r?.id) === rid)
    if (!role) return
    ensureRoleDefaults(role)

    state.draft.editRoleId = rid
    state.draft.roleName = String(role.name || '')
    state.draft.roleAvatar = String(role.avatar || '')
    state.draft.roleAvatarImage = looksLikeImageDataUrl(role.avatarImage) ? String(role.avatarImage || '') : ''
    state.draft.roleAvatarImageCropSrc = ''
    state.draft.roleSystemPrompt = String(role.systemPrompt || '')
    state.draft.roleTemperature = String(role.temperature ?? 0.7)
    state.draft.roleProviderId = String(role.modelRef?.providerId || '')
    const curModelId = String(role.modelRef?.modelId || '').trim()

    const p = getProvider(state.draft.roleProviderId)
    const cachedItems = Array.isArray(p?.modelsCache?.items) ? p.modelsCache.items : []
    state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }

    const inCache = !!curModelId && cachedItems.some((x) => String(x) === curModelId)
    state.draft.roleModelId = inCache ? curModelId : curModelId ? '__custom__' : ''
    state.draft.roleCustomModelId = inCache ? '' : curModelId

    state.modal = 'role'
    render()
  }

  function saveRoleEditor() {
    if (!state.data) return
    const rid = String(state.draft.editRoleId || '')

    const name = String(state.draft.roleName || '').trim() || '未命名角色'
    const avatar = String(state.draft.roleAvatar || '').trim() || '🙂'
    const avatarImage = looksLikeImageDataUrl(state.draft.roleAvatarImage) ? String(state.draft.roleAvatarImage || '') : ''
    const sys = String(state.draft.roleSystemPrompt || '').trim()
    const temperature = clampTemp(state.draft.roleTemperature)
    const providerId = String(state.draft.roleProviderId || '').trim()
    let modelId = String(state.draft.roleModelId || '').trim()
    if (modelId === '__custom__') modelId = String(state.draft.roleCustomModelId || '').trim()

    if (rid === NEW_ROLE_ID) {
      const newRid = uid('r')
      const cid = uid('c')
      const role = {
        id: newRid,
        name,
        avatar,
        avatarImage,
        systemPrompt: sys,
        temperature,
        modelRef: { providerId, modelId },
        createdAt: now(),
        updatedAt: now(),
      }
      ensureRoleDefaults(role)
      state.data.roles.unshift(role)
      if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
      state.data.chatsByRole[newRid] = {
        activeChatId: cid,
        chats: [{ id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }],
      }
      state.draft.activeRoleId = newRid
      save().catch(() => {})
      closeModal()
      return
    }

    const role = state.data.roles.find((r) => String(r?.id) === rid)
    if (!role) return

    role.name = name
    role.avatar = avatar
    role.avatarImage = avatarImage
    role.systemPrompt = sys
    role.temperature = temperature
    role.modelRef = { providerId, modelId }
    role.updatedAt = now()

    save().catch(() => {})
    closeModal()
  }

  function deleteRole(roleId) {
    if (!state.data) return
    const rid = String(roleId || '')
    state.data.roles = state.data.roles.filter((r) => String(r?.id) !== rid)
    if (state.data.chatsByRole && typeof state.data.chatsByRole === 'object') delete state.data.chatsByRole[rid]

    if (!state.data.roles.length) {
      const d = defaultData()
      state.data.settings.providers = state.data.settings.providers.length ? state.data.settings.providers : d.settings.providers
      state.data.roles = d.roles
      state.data.chatsByRole = d.chatsByRole
      state.data.ui = d.ui
    }

    state.draft.activeRoleId = String(state.data.roles[0]?.id || '')
    save().catch(() => {})
  }

  function openProvidersEditor() {
    state.draft.editProviderId = ''
    state.modal = 'providers'
    render()
  }

  function openProviderInlineEditor(providerId) {
    const p = getProvider(providerId)
    if (!p) return
    state.draft.editProviderId = String(p.id)
    state.draft.providerName = String(p.name || '')
    state.draft.providerBaseUrl = String(p.baseUrl || '')
    state.draft.providerApiKey = String(p.apiKey || '')
    render()
  }

  function saveProviderInlineEditor() {
    const pid = String(state.draft.editProviderId || '')
    const p = getProvider(pid)
    if (!p) return

    const desiredName = String(state.draft.providerName || '').replace(/\s+/g, ' ').trim() || '未命名供应商'
    const used = new Set((state.data?.settings?.providers || []).filter((x) => x && typeof x === 'object').map((x) => String(x.name || '')).filter(Boolean))
    used.delete(String(p.name || ''))
    let nextName = desiredName
    if (used.has(nextName)) {
      let i = 2
      while (used.has(`${desiredName}（${i}）`)) i++
      nextName = `${desiredName}（${i}）`
    }

    const oldId = String(p.id || '')
    p.name = nextName
    p.id = nextName
    p.baseUrl = String(state.draft.providerBaseUrl || '').trim() || 'http://'
    p.apiKey = String(state.draft.providerApiKey || '').trim()
    p.modelsCache = { items: [], fetchedAt: 0 }

    if (state.data) {
      for (const r of state.data.roles) {
        if (!r?.modelRef) continue
        if (String(r.modelRef.providerId || '') === oldId) r.modelRef.providerId = String(p.id || '')
      }
    }
    if (String(state.draft.roleProviderId || '') === oldId) state.draft.roleProviderId = String(p.id || '')
    state.draft.editProviderId = ''
    save().catch(() => {})
    render()
  }

  function createProvider() {
    if (!state.data) return
    const desiredName = '新供应商（OpenAI 兼容）'
    const used = new Set(state.data.settings.providers.map((p) => String(p?.name || '')).filter(Boolean))
    let name = desiredName
    if (used.has(name)) {
      let i = 2
      while (used.has(`${desiredName}（${i}）`)) i++
      name = `${desiredName}（${i}）`
    }
    const pid = name
    state.data.settings.providers.unshift({
      id: pid,
      name,
      baseUrl: 'http://',
      apiKey: '',
      modelsCache: { items: [], fetchedAt: 0 },
    })
    save().catch(() => {})
    openProviderInlineEditor(pid)
  }

  function deleteProvider(providerId) {
    if (!state.data) return
    const pid = String(providerId || '')
    if (state.data.settings.providers.length <= 1) return api.ui?.showToast?.('至少保留一个供应商')

    state.data.settings.providers = state.data.settings.providers.filter((p) => String(p?.id) !== pid)

    const fallback = String(state.data.settings.providers[0]?.id || '')
    for (const r of state.data.roles) {
      if (!r?.modelRef) continue
      if (String(r.modelRef.providerId) === pid) r.modelRef.providerId = fallback
    }

    save().catch(() => {})
  }

  function ensureChatsBox(roleId) {
    if (!state.data) return null
    const rid = String(roleId || '')
    if (!rid) return null
    if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
    if (!state.data.chatsByRole[rid] || typeof state.data.chatsByRole[rid] !== 'object') state.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
    const box = state.data.chatsByRole[rid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.activeChatId = String(box.activeChatId || '')
    if (!box.chats.length) {
      const cid = uid('c')
      box.chats = [{ id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }]
      box.activeChatId = cid
    }
    if (!box.activeChatId || !box.chats.some((c) => String(c?.id) === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
    return box
  }

  function ensureChatsBoxBare(roleId) {
    if (!state.data) return null
    const rid = String(roleId || '')
    if (!rid) return null
    if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
    if (!state.data.chatsByRole[rid] || typeof state.data.chatsByRole[rid] !== 'object') state.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
    const box = state.data.chatsByRole[rid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.activeChatId = String(box.activeChatId || '')
    if (box.activeChatId && !box.chats.some((c) => String(c?.id) === box.activeChatId)) box.activeChatId = ''
    if (!box.activeChatId && box.chats.length) box.activeChatId = String(box.chats[0]?.id || '')
    return box
  }

  function createChatForRole(roleId) {
    const rid = String(roleId || '')
    const box = ensureChatsBoxBare(rid)
    if (!box) return null
    const cid = uid('c')
    const chat = { id: cid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }
    box.chats.unshift(chat)
    box.activeChatId = cid
    return chat
  }

  function createChatForActiveRole() {
    const role = activeRole()
    if (!role) return api.ui?.showToast?.('请先选择角色')
    const rid = String(role.id || '')
    state.pendingChat = { roleId: rid, chat: { id: uid('pc'), title: '新聊天', createdAt: now(), updatedAt: now(), messages: [], pendingLocal: true } }
    state.sideTab = 'chats'
    state.draft.input = ''
    state.draft.images = []
    render()
    scrollToBottomSoon()
  }

  function pickChatForActiveRole(chatId) {
    const role = activeRole()
    if (!role || !state.data) return
    clearPendingChat()
    const box = ensureChatsBox(String(role.id))
    if (!box) return
    const cid = String(chatId || '')
    if (!cid || !box.chats.some((c) => String(c?.id) === cid)) return
    box.activeChatId = cid
    save().catch(() => {})
    render()
    scrollToBottomSoon()
  }

  function renameChatTitle(roleId, chatId, title) {
    if (!state.data) return
    const rid = String(roleId || '')
    const cid = String(chatId || '')
    if (!rid || !cid) return

    const box = ensureChatsBoxBare(rid)
    if (!box) return
    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((c) => String(c?.id) === cid) || null
    if (!chat) return

    let t = String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length > 80) t = t.slice(0, 80).trim()
    chat.title = t || '新聊天'

    save().catch(() => {})
    render()
  }

  function collectChatImagePathSet(chat: any): Set<string> {
    const out = new Set<string>()
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    for (const m of msgs) {
      const paths = normImagePaths(m?.images)
      for (const p of paths) {
        const s = String(p || '').trim()
        if (s) out.add(s)
      }
    }
    return out
  }

  function imageBasename(p: string): string {
    const s = String(p || '')
    const a = s.lastIndexOf('/')
    const b = s.lastIndexOf('\\')
    const i = Math.max(a, b)
    return i >= 0 ? s.slice(i + 1) : s
  }

  function collectOtherChatsImagePathSet(excludeRoleId: string, excludeChatId: string): Set<string> {
    const out = new Set<string>()
    if (!state.data) return out
    const byRole: Record<string, any> = state.data.chatsByRole && typeof state.data.chatsByRole === 'object' ? (state.data.chatsByRole as any) : {}
    for (const [rid, box] of Object.entries(byRole)) {
      const chats = Array.isArray((box as any)?.chats) ? (box as any).chats : []
      for (const c of chats) {
        const cid = String((c as any)?.id || '')
        if (String(rid) === String(excludeRoleId || '') && cid === String(excludeChatId || '')) continue
        const paths = collectChatImagePathSet(c)
        for (const p of paths) {
          out.add(p)
          const base = imageBasename(p)
          if (base && base !== p) out.add(base)
        }
      }
    }
    return out
  }

  async function deleteChatImages(paths: string[]): Promise<void> {
    const list = Array.isArray(paths) ? paths : []
    if (!list.length) return
    if (typeof api?.files?.images?.delete !== 'function') return
    for (const p of list) {
      const path = String(p || '').trim()
      if (!path) continue
      await api.files.images.delete({ scope: 'data', path }).catch(() => {})
    }
  }

  function deleteChatForRole(roleId, chatId) {
    if (!state.data) return
    const rid = String(roleId || '')
    const cid = String(chatId || '')
    if (!rid || !cid) return

    const box = ensureChatsBoxBare(rid)
    if (!box) return
    const before = Array.isArray(box.chats) ? box.chats : []
    const target = before.find((c) => String(c?.id) === cid) || null
    if (!target) return
    if (chatHasPendingAssistant(target)) {
      api.ui?.showToast?.('正在生成中，不能删除该会话')
      return
    }

    const targetImagePaths = collectChatImagePathSet(target)
    const otherImagePaths = targetImagePaths.size ? collectOtherChatsImagePathSet(rid, cid) : new Set<string>()
    const toDeleteImages: string[] = []
    for (const p of targetImagePaths) {
      const base = imageBasename(p)
      if (!otherImagePaths.has(p) && (!base || !otherImagePaths.has(base))) toDeleteImages.push(p)
    }

    box.chats = before.filter((c) => String(c?.id) !== cid)
    if (String(box.activeChatId || '') === cid) box.activeChatId = String(box.chats[0]?.id || '')

    if (!box.chats.length) {
      const nid = uid('c')
      box.chats = [{ id: nid, title: '新聊天', createdAt: now(), updatedAt: now(), messages: [] }]
      box.activeChatId = nid
    }

    void save()
      .then(() => deleteChatImages(toDeleteImages))
      .catch(() => {})
    render()
  }

  function onClick(e) {
    const t0 = e?.target
    if (!(t0 instanceof Element)) return

    let t = t0
    let act = ''
    while (t) {
      if (t instanceof Element && t.getAttribute('data-stop') === '1') return
      act = (t instanceof Element && t.getAttribute('data-act')) || ''
      if (act) break
      t = t.parentElement
    }
    if (!t || !act) return

    if (act === 'open-mermaid') {
      openMermaidViewer(t)
      return
    }

    if (act === 'mm-prev' || act === 'mm-next') {
      if (state.modal !== 'mermaid') return
      const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
      if (!len) return
      const delta = act === 'mm-prev' ? -1 : 1
      state.mermaid.index = (state.mermaid.index + delta + len) % len
      renderMermaidModalDom(true)
      return
    }

    if (act === 'mm-zoom-in' || act === 'mm-zoom-out' || act === 'mm-reset') {
      if (state.modal !== 'mermaid') return
      if (act === 'mm-reset') state.mermaid.scale = 1
      else {
        const factor = act === 'mm-zoom-in' ? 1.12 : 1 / 1.12
        state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, 0.2, 6)
      }
      applyMermaidScaleDom()
      return
    }

    if (act === 'side-tab') {
      const tab = String(t.getAttribute('data-tab') || '')
      state.sideTab = tab === 'chats' ? 'chats' : 'roles'
      render()
      return
    }

    if (act === 'close-modal') {
      closeModal()
      return
    }

    if (act === 'toggle-stream') {
      if (!state.data) return
      state.data.settings.streamEnabled = !state.data.settings.streamEnabled
      save().catch(() => {})
      renderTop()
      return
    }

    if (act === 'open-providers') return openProvidersEditor()
    if (act === 'new-role') return createRole()
    if (act === 'new-chat') return createChatForActiveRole()

    if (act === 'edit-role') {
      const r = activeRole()
      if (r) openRoleEditor(String(r.id))
      return
    }

    if (act === 'edit-role-inline') return openRoleEditor(String(t.getAttribute('data-id') || ''))

    if (act === 'pick-role') {
      state.draft.activeRoleId = String(t.getAttribute('data-id') || '')
      ensureChatsBox(state.draft.activeRoleId)
      save().catch(() => {})
      render()
      scrollToBottomSoon()
      return
    }

    if (act === 'pick-chat') return pickChatForActiveRole(String(t.getAttribute('data-id') || ''))

    if (act === 'pick-images') return pickImages()
    if (act === 'rm-draft-img') {
      removeDraftImage(String(t.getAttribute('data-id') || ''))
      renderComposer()
      return
    }

    if (act === 'send') return sendChat()
    if (act === 'refresh-models') return refreshModels(String(state.draft.roleProviderId || ''), true)
    if (act === 'save-role') return saveRoleEditor()

    if (act === 'ask-delete-role') {
      state.draft.deleteRoleId = String(t.getAttribute('data-id') || '')
      state.draft.deleteProviderId = ''
      state.modal = 'confirm'
      render()
      return
    }

    if (act === 'new-provider') return createProvider()

    if (act === 'edit-provider') {
      const pid = String(t.getAttribute('data-id') || '')
      if (String(state.draft.editProviderId || '') === pid) state.draft.editProviderId = ''
      else openProviderInlineEditor(pid)
      render()
      return
    }

    if (act === 'close-provider-editor') {
      state.draft.editProviderId = ''
      render()
      return
    }

    if (act === 'save-provider') return saveProviderInlineEditor()

    if (act === 'ask-delete-provider') {
      state.draft.deleteProviderId = String(t.getAttribute('data-id') || '')
      state.draft.deleteRoleId = ''
      state.modal = 'confirm'
      render()
      return
    }

    if (act === 'confirm-delete') {
      const rid = String(state.draft.deleteRoleId || '')
      const pid = String(state.draft.deleteProviderId || '')
      closeModal()
      if (rid) deleteRole(rid)
      if (pid) deleteProvider(pid)
      render()
      return
    }

    if (act === 'copy-msg') {
      const id = String(t.getAttribute('data-id') || '')
      const chat = activeChat()
      const m = chat?.messages?.find((x) => String(x?.id) === id)
      if (!m) return
      api.clipboard?.writeText?.(String(m.content || '')).then(
        () => api.ui?.showToast?.('已复制'),
        () => api.ui?.showToast?.('复制失败'),
      )
      return
    }
  }

  function onWheel(e) {
    if (state.modal !== 'mermaid') return
    const t = e?.target
    if (!(t instanceof Element)) return
    const stage = document.querySelector('[data-mm-stage="1"]')
    if (!(stage instanceof HTMLElement)) return
    if (!stage.contains(t)) return

    e.preventDefault()
    e.stopPropagation()
    const dir = Number(e?.deltaY || 0) < 0 ? 1 : -1
    const factor = dir > 0 ? 1.08 : 1 / 1.08
    state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, 0.2, 6)
    applyMermaidScaleDom()
  }

  function onMouseDown(e) {
    if (state.modal !== 'mermaid') return
    const t = e?.target
    if (!(t instanceof Element)) return
    if (e.button !== 1) return

    const stage = document.querySelector('[data-mm-stage="1"]')
    if (!(stage instanceof HTMLElement)) return
    if (!stage.contains(t)) return

    e.preventDefault()
    e.stopPropagation()

    mermaidDrag = {
      stage,
      x: Number(e.clientX || 0),
      y: Number(e.clientY || 0),
      sl: Number(stage.scrollLeft || 0),
      st: Number(stage.scrollTop || 0),
    }
    stage.setAttribute('data-mm-drag', '1')

    try {
      window.addEventListener('mousemove', onMouseMoveMermaid, { passive: false })
      window.addEventListener('mouseup', onMouseUpMermaid, { passive: true })
      window.addEventListener('blur', onMouseUpMermaid, { passive: true })
    } catch (_) {
      window.addEventListener('mousemove', onMouseMoveMermaid)
      window.addEventListener('mouseup', onMouseUpMermaid)
      window.addEventListener('blur', onMouseUpMermaid)
    }
  }

  function onInput(e) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    const bind = t.getAttribute('data-bind') || ''
    if (!bind) return
    state.draft[bind] = t.value
  }

  function onChange(e) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    const bind = t.getAttribute('data-bind') || ''
    if (!bind) return
    state.draft[bind] = t.value

    if (bind === 'roleProviderId') {
      const p = getProvider(String(state.draft.roleProviderId || ''))
      const cachedItems = Array.isArray(p?.modelsCache?.items) ? p.modelsCache.items : []
      state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      render()
      return
    }

    if (bind === 'roleModelId') {
      render()
      return
    }
  }

  function onKeyDown(e) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    if (t.getAttribute('data-bind') !== 'input') return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendChat()
    }
  }

  function onPaste(e) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    if (t.getAttribute('data-bind') !== 'input') return
    if (state.loading || state.sending) return

    const dt = e?.clipboardData
    const items = dt?.items ? Array.from(dt.items) : []
    const files = []
    for (const it of items) {
      if (!it || it.kind !== 'file') continue
      const type = String(it.type || '')
      if (!type.startsWith('image/')) continue
      const f = it.getAsFile?.()
      if (f) files.push(f)
    }
    if (!files.length) return

    const left = Math.max(0, MAX_DRAFT_IMAGES - (Array.isArray(state.draft.images) ? state.draft.images.length : 0))
    if (!left) return api.ui?.showToast?.(`最多选择 ${MAX_DRAFT_IMAGES} 张图片`)

    e.preventDefault()
    e.stopPropagation()

    ;(async () => {
      let added = 0
      for (const f of files.slice(0, left)) {
        try {
          const dataUrl = await readFileAsDataUrl(f)
          if (addDraftImage(String(f?.name || '粘贴图片'), dataUrl)) added++
        } catch (_) {}
      }
      if (!added) api.ui?.showToast?.('未识别到图片')
      renderComposer()
    })().catch(() => {})
  }

  async function init() {
    await ensureRenderer().catch(() => {})
    await load()
    startUiPollers()
    render()
  }

  ;(window as any).__fastWindowAiChat = {
    api,
    defaults: {
      mermaidFixSystemPrompt: DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
    },
    getState: () => state,
    getSnapshot: () => ver,
    subscribe,
    fmtTime,
    activeRole,
    activeChat,
    getProvider,
    renderAssistantInto,
    actions: {
      emit,
      setSideTab: (tab) => {
        state.sideTab = tab === 'chats' ? 'chats' : 'roles'
        emit()
      },
      setActiveRole: (roleId) => {
        clearPendingChat()
        state.draft.activeRoleId = String(roleId || '')
        ensureChatsBox(state.draft.activeRoleId)
        save().catch(() => {})
        emit()
      },
      setActiveChat: (chatId) => {
        pickChatForActiveRole(String(chatId || ''))
      },
      toggleStream: () => {
        if (!state.data) return
        state.data.settings.streamEnabled = !state.data.settings.streamEnabled
        save().catch(() => {})
        emit()
      },
      toggleTransparentChatBg: () => {
        if (!state.data) return
        state.data.settings.transparentChatBg = !state.data.settings.transparentChatBg
        save().catch(() => {})
        emit()
      },
      setChatBgOpacity: (opacity, commit) => {
        if (!state.data) return
        state.data.settings.chatBgOpacity = clamp(Math.round(Number(opacity || 0)), 0, 100)
        if (commit) save().catch(() => {})
        emit()
      },
      setChatBgBlur: (blur, commit) => {
        if (!state.data) return
        state.data.settings.chatBgBlur = clamp(Math.round(Number(blur || 0)), 0, 24)
        if (commit) save().catch(() => {})
        emit()
      },
      setTopbarOpacity: (opacity, commit) => {
        if (!state.data) return
        state.data.settings.topbarOpacity = clamp(Math.round(Number(opacity || 0)), 0, 100)
        if (commit) save().catch(() => {})
        emit()
      },
      setTopbarBlur: (blur, commit) => {
        if (!state.data) return
        state.data.settings.topbarBlur = clamp(Math.round(Number(blur || 0)), 0, 24)
        if (commit) save().catch(() => {})
        emit()
      },
      setComposerOpacity: (opacity, commit) => {
        if (!state.data) return
        state.data.settings.composerOpacity = clamp(Math.round(Number(opacity || 0)), 40, 100)
        if (commit) save().catch(() => {})
        emit()
      },
      setComposerBlur: (blur, commit) => {
        if (!state.data) return
        state.data.settings.composerBlur = clamp(Math.round(Number(blur || 0)), 0, 24)
        if (commit) save().catch(() => {})
        emit()
      },
      toggleUserMessageCollapse: () => {
        if (!state.data) return
        state.data.settings.userMessageCollapseEnabled = !state.data.settings.userMessageCollapseEnabled
        save().catch(() => {})
        emit()
      },
      setUserMessageCollapseLines: (lines, commit) => {
        if (!state.data) return
        state.data.settings.userMessageCollapseLines = clamp(Math.round(Number(lines || 8)), 1, 50)
        if (commit) save().catch(() => {})
        emit()
      },
      toggleStickersEnabled: () => {
        if (!state.data) return
        if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') state.data.settings.stickers = { enabled: false, categories: [], map: {} }
        state.data.settings.stickers.enabled = !state.data.settings.stickers.enabled
        save().catch(() => {})
        emit()
      },
      createStickerCategory: (categoryName) => {
        if (!state.data) return
        if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') state.data.settings.stickers = { enabled: false, categories: [], map: {} }
        const st = state.data.settings.stickers
        const v = validateStickerCategoryName(categoryName)
        if (!v.ok) return api.ui?.showToast?.(v.error || '分类名无效')

        const name = v.name
        if (!Array.isArray(st.categories)) st.categories = []
        if (st.categories.some((x) => String(x || '') === name)) return api.ui?.showToast?.('分类已存在')
        st.categories = st.categories.concat([name]).slice(0, 200)
        if (!st.map || typeof st.map !== 'object') st.map = {}
        if (!st.map[name] || typeof st.map[name] !== 'object') st.map[name] = {}
        save().catch(() => {})
        emit()
      },
      deleteStickerCategory: async (categoryName) => {
        if (!state.data) return
        const st = state.data.settings?.stickers
        if (!st || typeof st !== 'object') return

        const name = String(categoryName || '').trim()
        if (!name) return

        const box = st.map && typeof st.map === 'object' ? st.map[name] : null
        if (box && typeof box === 'object' && typeof api?.files?.images?.delete === 'function') {
          for (const v of Object.values(box)) {
            try {
              const relPath = v && typeof v === 'object' ? String((v as any).relPath || '').trim() : ''
              if (relPath) await api.files.images.delete({ scope: 'data', path: relPath }).catch(() => {})
            } catch (_) {}
          }
        }

        st.categories = Array.isArray(st.categories) ? st.categories.filter((x) => String(x || '').trim() !== name) : []
        if (st.map && typeof st.map === 'object') {
          try {
            delete st.map[name]
          } catch (_) {}
        }
        save().catch(() => {})
        emit()
      },
      addSticker: async (categoryName, stickerName, dataUrl) => {
        if (!state.data) return
        if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') state.data.settings.stickers = { enabled: false, categories: [], map: {} }

        const vCat = validateStickerCategoryName(categoryName)
        if (!vCat.ok) return api.ui?.showToast?.(vCat.error || '分类名无效')
        const cat = vCat.name

        const vName = validateStickerName(stickerName)
        if (!vName.ok) return api.ui?.showToast?.(vName.error || '表情名无效')
        const name = vName.name

        const r = await addStickerInternal(cat, name, dataUrl).catch((e) => ({ ok: false, kind: 'err' as const, error: e }))
        if (!r || !r.ok) {
          if (r?.kind === 'dup') return api.ui?.showToast?.('重名：该分类下已存在同名表情')
          if (r?.kind === 'no-perm') return api.ui?.showToast?.('未授权：files.images.writeBase64')
          if (r?.kind === 'bad-image') return api.ui?.showToast?.('图片格式不支持（仅支持 png/jpg/webp）')
          return api.ui?.showToast?.(String((r as any)?.error?.message || (r as any)?.error || '保存失败'))
        }

        save().catch(() => {})
        emit()
      },
      addStickersFromPickedImages: async (categoryName, pickedItems) => {
        if (!state.data) return
        const list = Array.isArray(pickedItems) ? pickedItems : []
        if (!list.length) return

        const vCat = validateStickerCategoryName(categoryName)
        if (!vCat.ok) return api.ui?.showToast?.(vCat.error || '分类名无效')
        const cat = vCat.name

        let ok = 0
        let dup = 0
        let bad = 0

        for (const it of list) {
          const fn = String(it?.name || '').trim()
          const base = fn ? fn.replace(/\.[a-zA-Z0-9]+$/, '').trim() : ''
          const vName = validateStickerName(base || `表情_${uid('n')}`)
          const name = vName.ok ? vName.name : `表情_${uid('n')}`
          const dataUrl = String(it?.dataUrl || '')
          try {
            const r = await addStickerInternal(cat, name, dataUrl).catch(() => ({ ok: false, kind: 'bad' as const }))
            if (r && (r as any).ok) ok++
            else if ((r as any)?.kind === 'dup') dup++
            else bad++
          } catch (_) {
            bad++
          }
        }

        if (ok) {
          save().catch(() => {})
          emit()
        }
        if (dup) api.ui?.showToast?.(`跳过重名：${dup} 个`)
        if (!ok && bad) api.ui?.showToast?.('导入失败')
      },
      deleteSticker: async (categoryName, stickerName) => {
        if (!state.data) return
        const st = state.data.settings?.stickers
        if (!st || typeof st !== 'object') return

        const cat = String(categoryName || '').trim()
        const name = String(stickerName || '').trim()
        if (!cat || !name) return

        const box = st.map && typeof st.map === 'object' ? st.map[cat] : null
        const it = box && typeof box === 'object' ? box[name] : null
        const relPath = it && typeof it === 'object' ? String(it.relPath || '').trim() : ''

        if (relPath && typeof api?.files?.images?.delete === 'function') {
          await api.files.images.delete({ scope: 'data', path: relPath }).catch(() => {})
        }

        if (box && typeof box === 'object') {
          try {
            delete box[name]
          } catch (_) {}
        }

        save().catch(() => {})
        emit()
      },
      renameSticker: (categoryName, oldStickerName, newStickerName) => {
        if (!state.data) return
        const st = state.data.settings?.stickers
        if (!st || typeof st !== 'object') return

        const vCat = validateStickerCategoryName(categoryName)
        if (!vCat.ok) return api.ui?.showToast?.(vCat.error || '分类名无效')
        const cat = vCat.name

        const oldName = String(oldStickerName || '').trim()
        if (!oldName) return

        const vName = validateStickerName(newStickerName)
        if (!vName.ok) return api.ui?.showToast?.(vName.error || '表情名无效')
        const name = vName.name

        if (name === oldName) return api.ui?.showToast?.('名称未变化')

        const box = st.map && typeof st.map === 'object' ? st.map[cat] : null
        if (!box || typeof box !== 'object') return api.ui?.showToast?.('分类不存在')

        const it = box[oldName]
        if (!it || typeof it !== 'object') return api.ui?.showToast?.('表情不存在')

        if (box[name]) return api.ui?.showToast?.('重名：该分类下已存在同名表情')

        const relPath = String((it as any).relPath || '').trim()
        if (!relPath) return api.ui?.showToast?.('映射损坏：缺少 relPath')

        const t = now()
        const createdAt = Number((it as any).createdAt || t)
        const next = { relPath, createdAt, updatedAt: t }
        box[name] = next
        try {
          delete box[oldName]
        } catch (_) {}

        save().catch(() => {})
        emit()
      },
      setMermaidFixEnabled: (on) => {
        if (!state.data) return
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {}
        state.data.settings.aiServices.mermaidFix.enabled = !!on
        save().catch(() => {})
        emit()
      },
      setMermaidFixProviderId: (providerId) => {
        if (!state.data) return
        const pid = String(providerId || '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {}
        state.data.settings.aiServices.mermaidFix.providerId = pid
        save().catch(() => {})
        emit()
      },
      setMermaidFixModelId: (modelId) => {
        if (!state.data) return
        const mid = String(modelId || '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {}
        state.data.settings.aiServices.mermaidFix.modelId = mid
        save().catch(() => {})
        emit()
      },
      setMermaidFixCustomModelId: (customModelId) => {
        if (!state.data) return
        const mid = String(customModelId || '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {}
        state.data.settings.aiServices.mermaidFix.customModelId = mid
        save().catch(() => {})
        emit()
      },
      setMermaidFixSystemPrompt: (systemPrompt) => {
        if (!state.data) return
        const p = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {}
        state.data.settings.aiServices.mermaidFix.systemPrompt = p
        save().catch(() => {})
        emit()
      },
      resetMermaidFixSystemPromptDefault: () => {
        if (!state.data) return
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.mermaidFix || typeof state.data.settings.aiServices.mermaidFix !== 'object') state.data.settings.aiServices.mermaidFix = {}
        state.data.settings.aiServices.mermaidFix.systemPrompt = DEFAULT_MERMAID_FIX_SYSTEM_PROMPT
        save().catch(() => {})
        emit()
      },
      closeModal: () => closeModal(),
      openProviders: () => openProvidersEditor(),
      createProvider: () => createProvider(),
      openProviderEditor: (providerId) => openProviderInlineEditor(String(providerId || '')),
      closeProviderEditor: () => {
        state.draft.editProviderId = ''
        emit()
      },
      saveProvider: () => saveProviderInlineEditor(),
      askDeleteProvider: (providerId) => {
        state.draft.deleteProviderId = String(providerId || '')
        state.draft.deleteRoleId = ''
        state.modal = 'confirm'
        emit()
      },
      openRoleEditor: (roleId) => openRoleEditor(String(roleId || '')),
      createRole: () => createRole(),
      saveRole: () => saveRoleEditor(),
      askDeleteRole: (roleId) => {
        const rid = String(roleId || '')
        if (!rid || rid === NEW_ROLE_ID) return
        state.draft.deleteRoleId = rid
        state.draft.deleteProviderId = ''
        state.modal = 'confirm'
        emit()
      },
      confirmDelete: () => {
        const rid = String(state.draft.deleteRoleId || '')
        const pid = String(state.draft.deleteProviderId || '')
        closeModal()
        if (rid) deleteRole(rid)
        if (pid) deleteProvider(pid)
        emit()
      },
      aiFixMermaid: (messageId, mermaidSrc, renderErrorMsg) =>
        aiFixMermaidInMessage(String(messageId || ''), String(mermaidSrc || ''), String(renderErrorMsg || '')),
      openMermaidViewer: (rootEl, srcEl) => {
        const root = rootEl instanceof Element ? rootEl : document.body
        const blocks = Array.from(root.querySelectorAll?.('.mermaid-block[data-mermaid=\"1\"]') || [])
        const items = []
        for (const b of blocks) {
          const svg = b instanceof HTMLElement ? String(b.innerHTML || '') : ''
          if (!svg) continue
          items.push({ svg })
        }
        if (!items.length) return

        let idx = 0
        const src = srcEl instanceof Element ? srcEl : null
        if (src) {
          const i = blocks.findIndex((b) => b === src || (b instanceof HTMLElement && b.contains(src)))
          if (i >= 0) idx = i
        }
        state.mermaid.items = items
        state.mermaid.index = clamp(idx, 0, Math.max(0, items.length - 1))
        state.mermaid.scale = 1
        state.modal = 'mermaid'
        emit()
      },
      openImageViewer: (rootEl, srcEl) => {
        const root = rootEl instanceof Element ? rootEl : document.body
        const imgs = Array.from(root.querySelectorAll?.('img[data-fw-img=\"1\"]') || [])
        const items = []
        const elToIdx = new Map()
        for (const img of imgs) {
          if (!(img instanceof HTMLImageElement)) continue
          const src = String(img.getAttribute('src') || '').trim()
          if (!src) continue
          const idx = items.length
          items.push({ src, alt: String(img.getAttribute('alt') || '图片') })
          elToIdx.set(img, idx)
        }
        if (!items.length) return

        let idx = 0
        const src = srcEl instanceof Element ? srcEl : null
        if (src) {
          const img = src instanceof HTMLImageElement ? src : (src.closest?.('img[data-fw-img=\"1\"]') as any)
          const i = img instanceof HTMLImageElement ? elToIdx.get(img) : -1
          if (typeof i === 'number' && i >= 0) idx = i
        }

        state.imageViewer.items = items
        state.imageViewer.index = clamp(idx, 0, Math.max(0, items.length - 1))
        state.imageViewer.scale = 1
        state.modal = 'image'
        emit()
      },
      mermaidPrev: () => {
        const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
        if (!len) return
        state.mermaid.index = (Number(state.mermaid.index || 0) - 1 + len) % len
        state.mermaid.scale = 1
        emit()
      },
      mermaidNext: () => {
        const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
        if (!len) return
        state.mermaid.index = (Number(state.mermaid.index || 0) + 1) % len
        state.mermaid.scale = 1
        emit()
      },
      mermaidZoom: (dir) => {
        const factor = Number(dir || 0) >= 0 ? 1.12 : 1 / 1.12
        state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, 0.2, 6)
        emit()
      },
      mermaidSetScale: (scale) => {
        state.mermaid.scale = clamp(Number(scale || 1), 0.2, 6)
        emit()
      },
      mermaidReset: () => {
        state.mermaid.scale = 1
        emit()
      },
      imagePrev: () => {
        const len = Array.isArray(state.imageViewer.items) ? state.imageViewer.items.length : 0
        if (!len) return
        state.imageViewer.index = (Number(state.imageViewer.index || 0) - 1 + len) % len
        state.imageViewer.scale = 1
        emit()
      },
      imageNext: () => {
        const len = Array.isArray(state.imageViewer.items) ? state.imageViewer.items.length : 0
        if (!len) return
        state.imageViewer.index = (Number(state.imageViewer.index || 0) + 1) % len
        state.imageViewer.scale = 1
        emit()
      },
      imageZoom: (dir) => {
        const factor = Number(dir || 0) >= 0 ? 1.12 : 1 / 1.12
        state.imageViewer.scale = clamp(Number(state.imageViewer.scale || 1) * factor, 0.2, 6)
        emit()
      },
      imageSetScale: (scale) => {
        state.imageViewer.scale = clamp(Number(scale || 1), 0.2, 6)
        emit()
      },
      imageReset: () => {
        state.imageViewer.scale = 1
        emit()
      },
      createChat: () => createChatForActiveRole(),
      renameChat: (roleId, chatId, title) => renameChatTitle(String(roleId || ''), String(chatId || ''), String(title ?? '')),
      deleteChat: (roleId, chatId) => deleteChatForRole(String(roleId || ''), String(chatId || '')),
      setDraft: (key, value) => {
        const k = String(key || '')
        if (!k) return
        ;(state.draft as any)[k] = value
        emit()
      },
      roleProviderChanged: (providerId) => {
        state.draft.roleProviderId = String(providerId || '')
        const p = getProvider(state.draft.roleProviderId)
        const cachedItems = Array.isArray(p?.modelsCache?.items) ? p.modelsCache.items : []
        state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }
        state.draft.roleModelId = ''
        state.draft.roleCustomModelId = ''
        emit()
      },
      roleModelChanged: (modelId) => {
        state.draft.roleModelId = String(modelId || '')
        emit()
      },
      refreshModels: (providerId, force) => refreshModels(String(providerId || ''), !!force),
      pickRoleAvatarImage: () => pickRoleAvatarImage(),
      clearRoleAvatarImage: () => clearRoleAvatarImage(),
      removeDraftImage: (id) => {
        removeDraftImage(String(id || ''))
        emit()
      },
      removeDraftFile: (id) => {
        removeDraftFile(String(id || ''))
        emit()
      },
      pickImages: () => pickImages(),
      addDraftImagesFromFiles: async (files) => {
        const list = Array.isArray(files) ? files : []
        const left = Math.max(0, MAX_DRAFT_IMAGES - (Array.isArray(state.draft.images) ? state.draft.images.length : 0))
        let added = 0
        for (const f of list.slice(0, left)) {
          try {
            const dataUrl = await readFileAsDataUrl(f)
            if (addDraftImage(String(f?.name || '图片'), dataUrl)) added++
          } catch (_) {}
        }
        if (!added) api.ui?.showToast?.('未识别到图片')
        emit()
      },
      addDraftFilesFromFiles: async (files) => {
        await addDraftFilesFromFiles(Array.isArray(files) ? files : [])
      },
      send: () => sendChat(),
      stop: () => {
        stopSending().catch(() => {})
      },
      regenerateAssistant: (assistantMid) => regenerateAssistantMessage(String(assistantMid || '')),
      replyFromUserMessage: (userMid) => replyFromUserMessage(String(userMid || '')),
      setChatModelOverride: (providerId, modelId) => {
        if (!state.data) return
        const role = activeRole()
        const chat = activeChatFromData()
        if (!role || !chat) return

        const pid = String(providerId || '').trim()
        const mid = String(modelId || '').trim()
        if (!pid || !mid) return api.ui?.showToast?.('供应商/模型 不能为空')

        const p = getProvider(pid)
        if (!p) return api.ui?.showToast?.('未找到该供应商')

        chat.modelOverride = { providerId: pid, modelId: mid }
        chat.updatedAt = now()
        save().catch(() => {})
        emit()
        api.ui?.showToast?.('已设置当前会话临时模型')
      },
      clearChatModelOverride: () => {
        if (!state.data) return
        const chat = activeChatFromData()
        if (!chat) return
        try {
          delete chat.modelOverride
        } catch (_e) {
          chat.modelOverride = null
        }
        chat.updatedAt = now()
        save().catch(() => {})
        emit()
        api.ui?.showToast?.('已清除当前会话临时模型')
      },
      deleteMessage: (messageId) => deleteMessage(String(messageId || '')),
      editMessage: (messageId, content) => editMessage(String(messageId || ''), content),
    },
  }

  init()
})()
