// ai-chat (iframe sandbox) (entry: index.js)
import { now, uid, esc, trimSlash, isHttpBaseUrl, clampTemp, normImagePaths, clamp } from './core/utils'
import { extractOpenAiDelta, sseFeed } from './core/sse'
import { createDefaultAssistantRenderEngine } from './render/assistantEngineDefault'
import {
  BUILTIN_TOOL_REQUEST_PRESETS,
  findBuiltinToolRequestPreset,
  normalizeToolRequestRenderPresets,
  resolveToolRequestRenderPreset,
  stringifyToolRequestRenderPreset,
  validateToolRequestRenderPreset,
} from './core/toolRequestPresets'
import {
  createToolRequestStreamTruncator,
  executeToolCallsOnServer,
  formatToolResponseBlock,
  mapParsedCallsToServerCalls,
  parseToolRequestCalls,
} from '@noelle-silva/eucli-aitoolcall-sdk'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerCode from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw'
import mammoth from 'mammoth/mammoth.browser'
import { extractPptMarkdown } from './core/ppt'
import { createAiChatFastWindowApi } from './bridge/tauriCompat'
import { IMAGE_VIEWER_ZOOM_MAX, MERMAID_VIEWER_ZOOM_MAX, VIEWER_ZOOM_MIN } from './core/viewerZoom'
;(function () {
  const api = createAiChatFastWindowApi(window.fastWindow, 'ai-chat')
  ;(window as any).fastWindow = api

  try {
    const g = (pdfjsLib as any)?.GlobalWorkerOptions
    if (g && !g.workerSrc && typeof pdfWorkerCode === 'string') {
      g.workerSrc = URL.createObjectURL(new Blob([pdfWorkerCode], { type: 'text/javascript' }))
    }
  } catch (_) {}

  const BG_JOB_KEY_PREFIX = 'bg.job.'
  const BG_STREAM_KEY_PREFIX = 'bg.stream.'
  const BG_CANCEL_KEY_PREFIX = 'bg.cancel.'
  const BG_CANCEL_MID_KEY_PREFIX = 'bg.cancel.mid.'
  const BG_QUEUE_KEY = 'bg.queue'
  const VERSION = 2
  const SPLIT_SCHEMA_VERSION = 1
  const SPLIT_META_KEY = 'meta/index'
  const STICKERS_KEY = 'stickers/index'
  const UI_CHAT_UPDATED_NOTICE_KEY = 'ui/notice/chat-updated'
  const runtime = String(api?.__meta?.runtime || 'ui')
  const runtimeStorage = api && (api as any).runtimeStorage && typeof (api as any).runtimeStorage.get === 'function' ? (api as any).runtimeStorage : api.storage
  const MAX_DRAFT_IMAGES = 8
  const MAX_DRAFT_FILES = 6
  const MAX_DRAFT_FILE_BYTES = 10 * 1024 * 1024 // 10MB
  const DEFAULT_ATTACH_MAX_FILE_MB = Math.round(MAX_DRAFT_FILE_BYTES / 1024 / 1024)
  const MAX_ATTACH_MAX_FILE_MB = 2048
  const DEFAULT_ATTACH_SEND_LIMIT_CHARS = 80_000
  const DEFAULT_TOOL_CALL_SERVER_BASE_URL = 'http://localhost:9083'
  const REF_IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA='
  const NEW_ROLE_ID = '__new__'
  const NEW_GROUP_ID = '__new_group__'
  const GROUP_SPEAKER_USER_PREFIX = '用户'
  const DEFAULT_MERMAID_FIX_SYSTEM_PROMPT = `你是 Mermaid 语法修复器。\n\n你会收到一段 Mermaid 源码（可能无法渲染）。你的任务：在尽量保持原意不变的前提下，修复语法/结构错误，让它可以被 Mermaid 渲染。\n\n输出要求：\n- 只输出修复后的 Mermaid 源码本体\n- 不要输出解释、不要输出 Markdown 代码块标记（不要输出 \`\`\`mermaid）`
  const DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT = `你是“聊天标题生成器”。\n\n你会收到一段聊天记录。你的任务：为这段聊天生成一个简短、贴切的中文标题。\n\n输出要求：\n- 只输出标题本身（纯文本）\n- 不要输出引号、不要输出解释\n- 尽量不超过 20 个汉字`
  const DEFAULT_STICKER_NAMING_SYSTEM_PROMPT = `你是“表情包取名助手”。\n\n你会收到一张表情包图片。你的任务：根据图片内容给它取一个简短、好记的中文名字。\n\n输出要求：\n- 只输出名字本身（纯文本）\n- 不要输出引号、不要输出解释\n- 不要包含 / 或 \\\\ 或 ] 或换行\n- 尽量不超过 12 个汉字`

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
    pendingGroupChat: null,
    branchDraft: null,
    draft: {
      input: '',
      images: [],
      files: [],
      activeTargetKind: 'role',
      activeRoleId: '',
      activeGroupId: '',

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

      editGroupId: '',
      groupName: '',
      groupAvatar: '',
      groupAvatarImage: '',
      groupAvatarImageCropSrc: '',
      groupPrompt: '',
      groupMode: 'roundRobin',
      groupMemberRoleIds: [],
      groupRoundRobinOrder: [],
      groupRandomWeights: {},
      groupRandomMinCount: 1,
      groupRandomMaxCount: 2,

      editProviderId: '',
      providerName: '',
      providerBaseUrl: '',
      providerApiKey: '',

      deleteRoleId: '',
      deleteGroupId: '',
      deleteProviderId: '',
    },
    data: null,
  }

  const CHAT_ATTACHMENT_KINDS = new Set(['txt', 'md', 'pdf', 'docx', 'ppt'])
  const CHAT_MSG_GROUP_ROLES = new Set(['root', 'attachment'])
  const CHAT_BRANCHING_SCHEMA_VERSION = 1
  const CHAT_DEFAULT_BRANCH_ID = 'main'
  const CHAT_DEFAULT_BRANCH_NAME = '主线'
  function normalizeMessageAttachments(input: any) {
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

  function normalizeMessageGroup(m: any) {
    const g = m && typeof m === 'object' ? m : null
    const groupId = String(g?.groupId || '').trim()
    const groupRole0 = String(g?.groupRole || '').trim()
    const groupRole = CHAT_MSG_GROUP_ROLES.has(groupRole0) ? groupRole0 : ''
    const groupParentMid = String(g?.groupParentMid || '').trim()
    if (!groupId || !groupRole) return { groupId: '', groupRole: '', groupParentMid: '' }
    if (groupRole === 'attachment' && !groupParentMid) return { groupId: '', groupRole: '', groupParentMid: '' }
    return { groupId, groupRole, groupParentMid }
  }

  function normalizeBranchId(input: any) {
    let s = String(input || '').trim()
    if (!s) return CHAT_DEFAULT_BRANCH_ID
    if (s.length > 60) s = s.slice(0, 60).trim()
    s = s.replace(/[^a-zA-Z0-9._-]/g, '_')
    return s || CHAT_DEFAULT_BRANCH_ID
  }

  function normalizeBranchName(input: any) {
    let s = String(input || '').replace(/\s+/g, ' ').trim()
    if (!s) return CHAT_DEFAULT_BRANCH_NAME
    if (s.length > 60) s = s.slice(0, 60).trim()
    return s || CHAT_DEFAULT_BRANCH_NAME
  }

  function createDefaultChatBranching(headMid: string, createdAt: number, updatedAt: number) {
    const hid = String(headMid || '').trim()
    const ca = Number(createdAt || now())
    const ua = Number(updatedAt || ca || now())
    return {
      schemaVersion: CHAT_BRANCHING_SCHEMA_VERSION,
      activeBranchId: CHAT_DEFAULT_BRANCH_ID,
      branches: [
        {
          id: CHAT_DEFAULT_BRANCH_ID,
          name: CHAT_DEFAULT_BRANCH_NAME,
          headMid: hid,
          createdAt: ca,
          updatedAt: ua,
          forkFromMid: '',
        },
      ],
    }
  }

  function normalizeChatBranching(raw: any, fallbackHeadMid: string, createdAt: number, updatedAt: number) {
    const r = raw && typeof raw === 'object' ? raw : null
    if (!r || Number((r as any).schemaVersion || 0) !== CHAT_BRANCHING_SCHEMA_VERSION) {
      return createDefaultChatBranching(fallbackHeadMid, createdAt, updatedAt)
    }

    const activeBranchId = normalizeBranchId((r as any).activeBranchId)
    const branches0 = Array.isArray((r as any).branches) ? (r as any).branches : []
    const branches = branches0
      .filter((b: any) => b && typeof b === 'object')
      .map((b: any) => {
        const id = normalizeBranchId(b.id)
        const name = normalizeBranchName(b.name)
        const headMid = String(b.headMid || '').trim()
        const ca = Number(b.createdAt || createdAt || now())
        const ua = Number(b.updatedAt || updatedAt || ca || now())
        const forkFromMid = String(b.forkFromMid || '').trim()
        return { id, name, headMid, createdAt: ca, updatedAt: ua, forkFromMid }
      })

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

    const out = {
      schemaVersion: CHAT_BRANCHING_SCHEMA_VERSION,
      activeBranchId,
      branches: Array.from(byId.values()).slice(0, 200),
    }

    return out
  }

  function rebuildLinearBranchingMessages(messages: any[], branchId: string) {
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

  function fillMissingBranchIdsOnly(messages: any[], branchId: string) {
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

  function touchActiveBranchHead(chat: any) {
    const c = chat && typeof chat === 'object' ? chat : null
    if (!c) return
    const msgs = Array.isArray((c as any).messages) ? (c as any).messages : []
    const lastMid = msgs.length ? String((msgs[msgs.length - 1] as any)?.id || '') : ''
    const createdAt = Number((c as any).createdAt || now())
    const updatedAt = Number((c as any).updatedAt || createdAt || now())

    const branching = normalizeChatBranching((c as any).branching, lastMid, createdAt, updatedAt)
    ;(c as any).branching = branching

    const bid = normalizeBranchId((branching as any).activeBranchId)
    const branches = Array.isArray((branching as any).branches) ? (branching as any).branches : []
    const b = branches.find((x: any) => String(x?.id || '') === bid) || null
    if (b) {
      b.headMid = lastMid
      b.updatedAt = updatedAt
    }
  }

  function repairChatLinearBranching(chat: any) {
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
    if (b) {
      b.headMid = headMid
      b.updatedAt = updatedAt
    }
  }

  function ensureChatBranching(chat: any) {
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

  function findChatBranch(chat: any, branchId: string) {
    const branching = ensureChatBranching(chat)
    if (!branching) return null
    const bid = normalizeBranchId(branchId)
    const branches = Array.isArray((branching as any).branches) ? (branching as any).branches : []
    return branches.find((b: any) => String(b?.id || '') === bid) || null
  }

  function ensureChatBranch(chat: any, branchId: string) {
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

  function setChatActiveBranchId(chat: any, branchId: string) {
    const branching = ensureChatBranching(chat)
    if (!branching) return
    const bid = normalizeBranchId(branchId)
    ensureChatBranch(chat, bid)
    ;(branching as any).activeBranchId = bid
    ;(chat as any).branching = branching
  }

  function setChatBranchHeadMid(chat: any, branchId: string, headMid: string) {
    const b = ensureChatBranch(chat, branchId)
    if (!b) return
    b.headMid = String(headMid || '').trim()
    b.updatedAt = Number((chat as any)?.updatedAt || now())
  }

  function genUniqueBranchId(branching: any) {
    const branches = Array.isArray(branching?.branches) ? branching.branches : []
    const used = new Set<string>(branches.map((b: any) => normalizeBranchId(b?.id)))
    for (let i = 0; i < 12; i++) {
      const id = normalizeBranchId(uid('b'))
      if (!used.has(id)) return id
    }
    return normalizeBranchId(uid('b'))
  }

  function findChatMessageById(chat: any, messageId: any) {
    const mid = String(messageId || '').trim()
    if (!mid) return null
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    return msgs.find((m: any) => m && typeof m === 'object' && String(m?.id || '') === mid) || null
  }

  function findPrevAssistantMidForAssistant(chat: any, assistantMid: any) {
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
        if (m && m.role === 'user') {
          userMsg = m
          userMid = String(m?.id || '').trim()
          break
        }
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

  function findAssistantSiblingsByUserMid(chat: any, userMid: string) {
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

  function groupFolderName(group) {
    return safeDirName(group?.name, '群组')
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

  async function syncGroupAvatarFile(folder, group) {
    const f = String(folder || '').trim()
    if (!f) return

    const relPath = `groups/${f}/avatar.png`
    const avatarImage = String(group?.avatarImage || '').trim()

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

  function splitGroupKey(folder) {
    return `groups/${String(folder || '')}/group`
  }

  function splitGroupChatKey(folder, chatId) {
    return `groups/${String(folder || '')}/chats/${String(chatId || '')}`
  }

  async function writeChatUpdatedNotice(targetKind: any, targetId: any, chatId: any, updatedAt: any) {
    const kind = String(targetKind || '').trim() === 'group' ? 'group' : 'role'
    const tid = String(targetId || '').trim()
    const cid = String(chatId || '').trim()
    if (!tid || !cid) return
    const t = now()
    try {
      await runtimeStorage.set(UI_CHAT_UPDATED_NOTICE_KEY, {
        id: uid('n'),
        targetKind: kind,
        targetId: tid,
        chatId: cid,
        updatedAt: Number(updatedAt || 0),
        at: t,
      })
    } catch (_) {}
  }

  function normalizeSplitMeta(raw) {
    if (!raw || typeof raw !== 'object') return null
    const schemaVersion = Number(raw.schemaVersion || 0)
    if (schemaVersion !== SPLIT_SCHEMA_VERSION) return null

    const roleOrder = Array.isArray(raw.roleOrder) ? raw.roleOrder.map((x) => String(x || '')).filter((x) => !!x) : []
    const roleFolders = raw.roleFolders && typeof raw.roleFolders === 'object' ? raw.roleFolders : {}
    const chatIndexByRole = raw.chatIndexByRole && typeof raw.chatIndexByRole === 'object' ? raw.chatIndexByRole : {}
    const groupOrder = Array.isArray((raw as any).groupOrder) ? (raw as any).groupOrder.map((x: any) => String(x || '')).filter((x: any) => !!x) : []
    const groupFolders = (raw as any).groupFolders && typeof (raw as any).groupFolders === 'object' ? (raw as any).groupFolders : {}
    const chatIndexByGroup =
      (raw as any).chatIndexByGroup && typeof (raw as any).chatIndexByGroup === 'object' ? (raw as any).chatIndexByGroup : {}

    return {
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: Number(raw.dataVersion || VERSION),
      updatedAt: Number(raw.updatedAt || 0),
      ui: raw.ui && typeof raw.ui === 'object' ? raw.ui : {},
      settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
      roleOrder,
      roleFolders,
      chatIndexByRole,
      groupOrder,
      groupFolders,
      chatIndexByGroup,
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

  // meta/index 是全局共享索引：并发 read-modify-write 会丢更新（最后一次写覆盖前一次）。
  // 背景任务允许多会话并发，因此必须把 meta/index 的写入串行化。
  let splitMetaWriteChain: Promise<void> = Promise.resolve()
  function withSplitMetaWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => Promise.resolve().then(fn)
    const p = splitMetaWriteChain.then(run, run) as Promise<T>
    splitMetaWriteChain = p.then(
      () => undefined,
      () => undefined,
    )
    return p
  }

  async function touchChatUpdatedAt(roleId, chatId, updatedAt) {
    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!rid || !cid) return

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) return
      const idx = meta.chatIndexByRole?.[rid]
      if (!idx || typeof idx !== 'object') return
      if (!(idx as any).chatUpdatedAt || typeof (idx as any).chatUpdatedAt !== 'object') (idx as any).chatUpdatedAt = {}
      ;(idx as any).chatUpdatedAt[String(cid)] = ua0 > 0 ? ua0 : now()
      meta.updatedAt = now()
      await api.storage.set(SPLIT_META_KEY, meta)
      splitMetaCache = meta
    })
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
      groups: [],
      chatsByGroup: {},
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

    for (const gid of (meta as any).groupOrder || []) {
      const folder = String((meta as any).groupFolders?.[gid] || '')
      if (!folder) throw new Error('存储索引损坏：groupFolders 缺失')

      const g0 = await api.storage.get(splitGroupKey(folder))
      const group = g0 && typeof g0 === 'object' ? g0 : null
      if (!group) throw new Error('存储损坏：群组文件缺失或无效')

      ;(d as any).groups.push(group)

      const idx = (meta as any).chatIndexByGroup?.[gid]
      const box = idx && typeof idx === 'object' ? idx : {}
      const activeChatId = String((box as any).activeChatId || '')
      const chatIds = Array.isArray((box as any).chatIds) ? (box as any).chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []

      const chats = []
      for (const cid of chatIds) {
        const c0 = await api.storage.get(splitGroupChatKey(folder, cid))
        const c = c0 && typeof c0 === 'object' ? c0 : null
        if (!c) throw new Error('存储损坏：群聊会话文件缺失或无效')
        chats.push(c)
      }

      ;(d as any).chatsByGroup[String(group.id || gid)] = { activeChatId, chats }
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
    const groups = Array.isArray((d as any).groups) ? (d as any).groups : []
    const chatsByGroup = (d as any).chatsByGroup && typeof (d as any).chatsByGroup === 'object' ? (d as any).chatsByGroup : {}

    const old = splitMetaCache || (await loadSplitMeta())
    const oldRoleFolders = old?.roleFolders && typeof old.roleFolders === 'object' ? old.roleFolders : {}
    const oldChatIndexByRole = old?.chatIndexByRole && typeof old.chatIndexByRole === 'object' ? old.chatIndexByRole : {}
    const oldGroupFolders = (old as any)?.groupFolders && typeof (old as any).groupFolders === 'object' ? (old as any).groupFolders : {}
    const oldChatIndexByGroup =
      (old as any)?.chatIndexByGroup && typeof (old as any).chatIndexByGroup === 'object' ? (old as any).chatIndexByGroup : {}

    const roleOrder = roles.map((r) => String(r?.id || '')).filter((x) => !!x)
    const roleFolders = {}
    const chatIndexByRole = {}

    const groupOrder = groups.map((g: any) => String(g?.id || '')).filter((x: any) => !!x)
    const groupFolders = {}
    const chatIndexByGroup = {}

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

    const usedGroupFolders = new Set()
    for (const g of groups) {
      const gid = String((g as any)?.id || '')
      if (!gid) continue
      const base = groupFolderName(g)
      let folder = base
      if (usedGroupFolders.has(folder)) {
        const tail = gid.slice(Math.max(0, gid.length - 8)) || uid('g')
        folder = `${base}__${tail}`
      }
      usedGroupFolders.add(folder)
      ;(groupFolders as any)[gid] = folder
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

    for (const g of groups) {
      const gid = String((g as any)?.id || '')
      if (!gid) continue
      const folder = String((groupFolders as any)[gid] || '')
      const box0 = (chatsByGroup as any)[gid] && typeof (chatsByGroup as any)[gid] === 'object' ? (chatsByGroup as any)[gid] : { activeChatId: '', chats: [] }
      const activeChatId = String((box0 as any).activeChatId || '')
      const chats = Array.isArray((box0 as any).chats) ? (box0 as any).chats : []
      const chatIds = chats.map((c: any) => String(c?.id || '')).filter((x: any) => !!x)
      const chatUpdatedAt: any = {}
      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        chatUpdatedAt[cid] = Number(c?.updatedAt || 0)
      }
      ;(chatIndexByGroup as any)[gid] = { activeChatId, chatIds, chatUpdatedAt }

      // 群组文件：小，不做增量优化
      try {
        await api.storage.set(splitGroupKey(folder), g)
      } catch (_) {}

      await syncGroupAvatarFile(folder, g)

      const oldFolder = String((oldGroupFolders as any)?.[gid] || '')
      const oldIdx = (oldChatIndexByGroup as any)?.[gid]
      const oldUpdated =
        oldIdx && typeof oldIdx === 'object' && (oldIdx as any).chatUpdatedAt && typeof (oldIdx as any).chatUpdatedAt === 'object'
          ? (oldIdx as any).chatUpdatedAt
          : {}

      for (const c of chats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        const newKey = splitGroupChatKey(folder, cid)
        const oldKey = oldFolder ? splitGroupChatKey(oldFolder, cid) : ''
        const updatedAt = Number(c?.updatedAt || 0)
        const prev = Number((oldUpdated as any)?.[cid] || 0)
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
      groupOrder,
      groupFolders,
      chatIndexByGroup,
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

      const newGroupSet = new Set(groupOrder)
      const newChatSetByGroup: any = {}
      for (const gid of groupOrder) {
        const idx = (chatIndexByGroup as any)?.[gid]
        const ids = Array.isArray((idx as any)?.chatIds) ? (idx as any).chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []
        newChatSetByGroup[gid] = new Set(ids)
      }

      const oldGroups = Array.isArray((old as any).groupOrder) ? (old as any).groupOrder : []
      for (const gid0 of oldGroups) {
        const gid = String(gid0 || '')
        if (!gid) continue
        const oldFolder = String((oldGroupFolders as any)?.[gid] || '')
        if (!oldFolder) continue

        if (!newGroupSet.has(gid)) {
          try {
            await api.storage.remove(splitGroupKey(oldFolder))
          } catch (_) {}
          const oldIdx = (oldChatIndexByGroup as any)?.[gid]
          const oldChatIds = Array.isArray((oldIdx as any)?.chatIds) ? (oldIdx as any).chatIds : []
          for (const cid0 of oldChatIds) {
            const cid = String(cid0 || '')
            if (!cid) continue
            try {
              await api.storage.remove(splitGroupChatKey(oldFolder, cid))
            } catch (_) {}
          }
          continue
        }

        const newFolder = String((groupFolders as any)?.[gid] || '')
        if (newFolder && newFolder !== oldFolder) {
          try {
            await api.storage.remove(splitGroupKey(oldFolder))
          } catch (_) {}
          const oldIdx = (oldChatIndexByGroup as any)?.[gid]
          const oldChatIds = Array.isArray((oldIdx as any)?.chatIds) ? (oldIdx as any).chatIds : []
          for (const cid0 of oldChatIds) {
            const cid = String(cid0 || '')
            if (!cid) continue
            try {
              await api.storage.remove(splitGroupChatKey(oldFolder, cid))
            } catch (_) {}
          }
          continue
        }

        const keep = newChatSetByGroup[gid]
        const oldIdx = (oldChatIndexByGroup as any)?.[gid]
        const oldChatIds = Array.isArray((oldIdx as any)?.chatIds) ? (oldIdx as any).chatIds : []
        for (const cid0 of oldChatIds) {
          const cid = String(cid0 || '')
          if (!cid) continue
          if (keep && keep.has(cid)) continue
          try {
            await api.storage.remove(splitGroupChatKey(oldFolder, cid))
          } catch (_) {}
        }
      }
    }
  }

  async function readJobQueue() {
    try {
      const raw = await runtimeStorage.get(BG_QUEUE_KEY)
      const list = Array.isArray(raw) ? raw : []
      return list.map((x) => String(x || '')).filter((x) => !!x).slice(0, 2000)
    } catch (_) {
      return []
    }
  }

  async function writeJobQueue(ids) {
    try {
      const list = Array.isArray(ids) ? ids.map((x) => String(x || '')).filter((x) => !!x) : []
      await runtimeStorage.set(BG_QUEUE_KEY, list.slice(0, 2000))
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
    const t = now()
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
            branchTree: { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' },
            toolRequestRenderPreset: 'classic',
            toolRequestRenderPresets: [],
            userMessageCollapseEnabled: false,
            userMessageCollapseLines: 8,
            attachments: {
              sendLimitChars: DEFAULT_ATTACH_SEND_LIMIT_CHARS,
              maxFileSizeMbByKind: {
                txt: DEFAULT_ATTACH_MAX_FILE_MB,
                md: DEFAULT_ATTACH_MAX_FILE_MB,
                pdf: DEFAULT_ATTACH_MAX_FILE_MB,
                docx: DEFAULT_ATTACH_MAX_FILE_MB,
                ppt: DEFAULT_ATTACH_MAX_FILE_MB,
              },
            },
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
              chatTitleNaming: {
                enabled: false,
                providerId: pid,
                modelId: '',
                customModelId: '',
                systemPrompt: DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
              },
              stickerNaming: {
                enabled: false,
                providerId: pid,
                modelId: '',
                customModelId: '',
                systemPrompt: DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
              },
            },
            toolCallServer: {
              baseUrl: DEFAULT_TOOL_CALL_SERVER_BASE_URL,
              token: '',
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
          chats: [{ id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }],
        },
      },
      groups: [],
      chatsByGroup: {},
      ui: { activeTargetKind: 'role', activeRoleId: rid, activeGroupId: '' },
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
    if (!(d.settings as any).branchTree || typeof (d.settings as any).branchTree !== 'object') (d.settings as any).branchTree = { dir: 'lr' }
    const btree = (d.settings as any).branchTree
    const dir0 = String(btree?.dir || '').trim()
    const okDir = dir0 === 'lr' || dir0 === 'tb' || dir0 === 'bt' || dir0 === 'rl'
    btree.dir = okDir ? dir0 : 'lr'
    const view0 = String(btree?.view || '').trim()
    const okView = view0 === 'right' || view0 === 'float'
    btree.view = okView ? view0 : 'right'
    if (typeof btree.followSelected !== 'boolean') btree.followSelected = true
    if (typeof btree.modalHotkey !== 'string') btree.modalHotkey = ''
    btree.modalHotkey = String(btree.modalHotkey || '').trim().slice(0, 80)
    if (typeof d.settings.toolRequestRenderPreset !== 'string') d.settings.toolRequestRenderPreset = 'classic'
    ;(d.settings as any).toolRequestRenderPresets = normalizeToolRequestRenderPresets((d.settings as any).toolRequestRenderPresets)
    if (typeof d.settings.userMessageCollapseEnabled !== 'boolean') d.settings.userMessageCollapseEnabled = false
    if (typeof d.settings.userMessageCollapseLines !== 'number' || !isFinite(d.settings.userMessageCollapseLines)) d.settings.userMessageCollapseLines = 8
    if (!d.settings.attachments || typeof d.settings.attachments !== 'object') d.settings.attachments = {}
    const at = d.settings.attachments
    // 兼容旧字段：maxCharsPerFile/maxTotalChars（旧实现：自动截断）
    if (typeof at.sendLimitChars !== 'number' || !isFinite(at.sendLimitChars)) {
      if (typeof at.maxCharsPerFile === 'number' && isFinite(at.maxCharsPerFile)) at.sendLimitChars = at.maxCharsPerFile
      else at.sendLimitChars = DEFAULT_ATTACH_SEND_LIMIT_CHARS
    }
    d.settings.chatBgOpacity = clamp(Math.round(Number(d.settings.chatBgOpacity || 0)), 0, 100)
    d.settings.chatBgBlur = clamp(Math.round(Number(d.settings.chatBgBlur || 0)), 0, 24)
    d.settings.topbarOpacity = clamp(Math.round(Number(d.settings.topbarOpacity || 0)), 0, 100)
    d.settings.topbarBlur = clamp(Math.round(Number(d.settings.topbarBlur || 0)), 0, 24)
    d.settings.composerOpacity = clamp(Math.round(Number(d.settings.composerOpacity || 0)), 40, 100)
    d.settings.composerBlur = clamp(Math.round(Number(d.settings.composerBlur || 0)), 0, 24)
    d.settings.toolRequestRenderPreset = String(d.settings.toolRequestRenderPreset || '').trim().slice(0, 60) || 'classic'
    d.settings.userMessageCollapseLines = clamp(Math.round(Number(d.settings.userMessageCollapseLines || 8)), 1, 50)
    at.sendLimitChars = clamp(Math.round(Number(at.sendLimitChars || DEFAULT_ATTACH_SEND_LIMIT_CHARS)), 1000, 2_000_000)

    if (!at.maxFileSizeMbByKind || typeof at.maxFileSizeMbByKind !== 'object') (at as any).maxFileSizeMbByKind = {}
    const mb = (at as any).maxFileSizeMbByKind
    const normMb = (v) => {
      const n = Number(v)
      if (!isFinite(n)) return DEFAULT_ATTACH_MAX_FILE_MB
      return clamp(Math.round(n), 0, MAX_ATTACH_MAX_FILE_MB)
    }
    mb.txt = normMb(mb.txt)
    mb.md = normMb(mb.md)
    mb.pdf = normMb(mb.pdf)
    mb.docx = normMb(mb.docx)
    mb.ppt = normMb(mb.ppt)
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

    if (!as.chatTitleNaming || typeof as.chatTitleNaming !== 'object') as.chatTitleNaming = {}
    const ctn = as.chatTitleNaming as any
    if (typeof ctn.enabled !== 'boolean') ctn.enabled = false
    if (typeof ctn.providerId !== 'string') ctn.providerId = fallbackPid
    if (!ctn.providerId || !d.settings.providers.some((p) => String(p?.id || '') === String(ctn.providerId || ''))) ctn.providerId = fallbackPid
    if (typeof ctn.modelId !== 'string') ctn.modelId = ''
    if (typeof ctn.customModelId !== 'string') ctn.customModelId = ''
    if (typeof ctn.systemPrompt !== 'string') ctn.systemPrompt = DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT

    if (!as.stickerNaming || typeof as.stickerNaming !== 'object') as.stickerNaming = {}
    const sn = as.stickerNaming as any
    if (typeof sn.enabled !== 'boolean') sn.enabled = false
    if (typeof sn.providerId !== 'string') sn.providerId = fallbackPid
    if (!sn.providerId || !d.settings.providers.some((p) => String(p?.id || '') === String(sn.providerId || ''))) sn.providerId = fallbackPid
    if (typeof sn.modelId !== 'string') sn.modelId = ''
    if (typeof sn.customModelId !== 'string') sn.customModelId = ''
    if (typeof sn.systemPrompt !== 'string') sn.systemPrompt = DEFAULT_STICKER_NAMING_SYSTEM_PROMPT

    if (!d.settings.toolCallServer || typeof d.settings.toolCallServer !== 'object') d.settings.toolCallServer = {}
    const tcs = d.settings.toolCallServer
    if (typeof tcs.baseUrl !== 'string') tcs.baseUrl = DEFAULT_TOOL_CALL_SERVER_BASE_URL
    tcs.baseUrl = String(tcs.baseUrl || '').trim() || DEFAULT_TOOL_CALL_SERVER_BASE_URL
    if (typeof tcs.token !== 'string') tcs.token = ''

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
          const fallbackHeadMid = messages.length ? String((messages[messages.length - 1] as any)?.id || '') : ''
          const branching = normalizeChatBranching((cc as any).branching, fallbackHeadMid, createdAt, updatedAt)
          const activeBranchId = normalizeBranchId((branching as any).activeBranchId)
          const modelOverride = normalizeChatModelOverride(cc)

          const out: any = {
            id: cid,
            title,
            createdAt,
            updatedAt,
            branching,
            messages: messages
              .filter((m) => m && typeof m === 'object')
                .map((m) => ({
                  id: String(m.id || uid('m')),
                  role: m.role === 'assistant' ? 'assistant' : 'user',
                  speakerRoleId: String((m as any).speakerRoleId || '').trim(),
                  content: String(m.content || ''),
                  images: normImagePaths(m.images),
                  attachments: normalizeMessageAttachments((m as any).attachments),
                  ...normalizeMessageGroup(m),
                  // 会话内分支（数据层先落好结构；UI 以后再做）
                  branchId: normalizeBranchId((m as any).branchId || activeBranchId),
                  parentMid: String((m as any).parentMid || '').trim(),
                  pending: !!m.pending,
                  streaming: !!m.streaming,
                  createdAt: Number(m.createdAt || now()),
                })),
          }

          if (modelOverride) out.modelOverride = modelOverride

          // 现阶段：UI 仍是线性展示；先保证“主线”有稳定的 parent 链和 headMid。
          const branches0 = Array.isArray(out.branching?.branches) ? out.branching.branches : []
          const idSet = new Set<string>()
          for (const b of branches0) {
            const id = normalizeBranchId((b as any)?.id)
            if (id) idSet.add(id)
            if (idSet.size >= 2) break
          }
          let headMid = ''
          if (idSet.size >= 2) {
            fillMissingBranchIdsOnly(out.messages, activeBranchId)
            headMid = out.messages.length ? String((out.messages[out.messages.length - 1] as any)?.id || '') : ''
          } else {
            headMid = rebuildLinearBranchingMessages(out.messages, activeBranchId)
          }
          try {
            const branches = Array.isArray(out.branching?.branches) ? out.branching.branches : []
            const b = branches.find((x: any) => String(x?.id || '') === String(out.branching?.activeBranchId || '')) || null
            if (b) {
              b.headMid = headMid
              b.updatedAt = updatedAt
            }
          } catch (_) {}

          return out
        })

      if (!box.chats.length) {
        const cid = uid('c')
        const t = now()
        box.chats = [{ id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
        box.activeChatId = cid
      }

      if (!box.activeChatId || !box.chats.some((c) => String(c.id) === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
    }

    if (!d.ui || typeof d.ui !== 'object') d.ui = {}
    if (!Array.isArray((d as any).groups)) (d as any).groups = []
    const groupList0 = Array.isArray((d as any).groups) ? (d as any).groups : []
    const roleIdSet = new Set((Array.isArray(d.roles) ? d.roles : []).map((r: any) => String(r?.id || '')).filter(Boolean))
    ;(d as any).groups = groupList0
      .filter((g: any) => g && typeof g === 'object')
      .map((g: any) => {
        const id = String(g.id || uid('g'))
        const name = typeof g.name === 'string' && g.name.trim() ? String(g.name || '').trim() : '未命名群组'
        const avatar = typeof g.avatar === 'string' && g.avatar.trim() ? String(g.avatar || '').trim() : '👥'
        let avatarImage = typeof g.avatarImage === 'string' ? String(g.avatarImage || '') : ''
        if (avatarImage && !looksLikeImageDataUrl(avatarImage)) avatarImage = ''
        const prompt = typeof g.prompt === 'string' ? String(g.prompt || '') : ''
        const mode0 = String(g.mode || '').trim()
        const mode = mode0 === 'random' ? 'random' : 'roundRobin'

        const members0 = Array.isArray(g.memberRoleIds) ? g.memberRoleIds : Array.isArray(g.members) ? g.members : []
        const memberRoleIds = members0.map((x: any) => String(x || '')).filter((x: any) => !!x && roleIdSet.has(x)).slice(0, 50)

        const order0 = Array.isArray(g.roundRobinOrder) ? g.roundRobinOrder : Array.isArray(g.orderRoleIds) ? g.orderRoleIds : []
        const roundRobinOrder = order0.map((x: any) => String(x || '')).filter((x: any) => !!x && memberRoleIds.includes(x)).slice(0, 80)
        const orderFinal = roundRobinOrder.length ? roundRobinOrder : memberRoleIds.slice()

        const random0 = g.random && typeof g.random === 'object' ? g.random : {}
        const weights0 = (random0 as any).weightsByRoleId && typeof (random0 as any).weightsByRoleId === 'object' ? (random0 as any).weightsByRoleId : g.randomWeights
        const weightsBox = weights0 && typeof weights0 === 'object' ? weights0 : {}
        const weightsByRoleId: any = {}
        for (const rid of memberRoleIds) {
          const w = Number((weightsBox as any)[rid] ?? 1)
          weightsByRoleId[rid] = isFinite(w) && w >= 0 ? w : 1
        }
        let minCount = Number((random0 as any).minCount ?? g.randomMinCount ?? 1)
        let maxCount = Number((random0 as any).maxCount ?? g.randomMaxCount ?? 2)
        if (!isFinite(minCount)) minCount = 1
        if (!isFinite(maxCount)) maxCount = 2
        minCount = clamp(Math.round(minCount), 1, 20)
        maxCount = clamp(Math.round(maxCount), 1, 20)
        if (maxCount < minCount) maxCount = minCount

        return {
          id,
          name,
          avatar,
          avatarImage,
          prompt,
          mode,
          memberRoleIds,
          roundRobinOrder: orderFinal,
          random: { weightsByRoleId, minCount, maxCount },
          createdAt: Number(g.createdAt || now()),
          updatedAt: Number(g.updatedAt || now()),
        }
      })

    if (!(d as any).chatsByGroup || typeof (d as any).chatsByGroup !== 'object') (d as any).chatsByGroup = {}
    for (const g of (d as any).groups) {
      const gid = String(g.id || '')
      if (!gid) continue
      if (!(d as any).chatsByGroup[gid] || typeof (d as any).chatsByGroup[gid] !== 'object') (d as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
      const box = (d as any).chatsByGroup[gid]
      if (!Array.isArray(box.chats)) box.chats = []
      box.activeChatId = String(box.activeChatId || '')

      box.chats = box.chats
        .filter((c: any) => c && typeof c === 'object')
        .map((c: any) => {
          const cc = c
          const cid = String(cc.id || uid('gc'))
          const title = typeof cc.title === 'string' && cc.title.trim() ? cc.title : '群聊'
          const createdAt = Number(cc.createdAt || now())
          const updatedAt = Number(cc.updatedAt || createdAt || now())
          const messages = Array.isArray(cc.messages) ? cc.messages : []
          const fallbackHeadMid = messages.length ? String((messages[messages.length - 1] as any)?.id || '') : ''
          const branching = normalizeChatBranching((cc as any).branching, fallbackHeadMid, createdAt, updatedAt)
          const activeBranchId = normalizeBranchId((branching as any).activeBranchId)
          const modelOverride = normalizeChatModelOverride(cc)

          const out: any = {
            id: cid,
            title,
            createdAt,
            updatedAt,
            branching,
            messages: messages
              .filter((m: any) => m && typeof m === 'object')
              .map((m: any) => ({
                id: String(m.id || uid('m')),
                role: m.role === 'assistant' ? 'assistant' : 'user',
                speakerRoleId: String((m as any).speakerRoleId || '').trim(),
                content: String(m.content || ''),
                images: normImagePaths(m.images),
                attachments: normalizeMessageAttachments((m as any).attachments),
                ...normalizeMessageGroup(m),
                branchId: normalizeBranchId((m as any).branchId || activeBranchId),
                parentMid: String((m as any).parentMid || '').trim(),
                pending: !!m.pending,
                streaming: !!m.streaming,
                createdAt: Number(m.createdAt || now()),
              })),
          }

          if (modelOverride) out.modelOverride = modelOverride

          const branches0 = Array.isArray(out.branching?.branches) ? out.branching.branches : []
          const idSet = new Set<string>()
          for (const b of branches0) {
            const id = normalizeBranchId((b as any)?.id)
            if (id) idSet.add(id)
            if (idSet.size >= 2) break
          }
          let headMid = ''
          if (idSet.size >= 2) {
            fillMissingBranchIdsOnly(out.messages, activeBranchId)
            headMid = out.messages.length ? String((out.messages[out.messages.length - 1] as any)?.id || '') : ''
          } else {
            headMid = rebuildLinearBranchingMessages(out.messages, activeBranchId)
          }
          try {
            const branches = Array.isArray(out.branching?.branches) ? out.branching.branches : []
            const b = branches.find((x: any) => String(x?.id || '') === String(out.branching?.activeBranchId || '')) || null
            if (b) {
              b.headMid = headMid
              b.updatedAt = updatedAt
            }
          } catch (_) {}

          return out
        })

      if (!box.chats.length) {
        const cid = uid('gc')
        const t = now()
        box.chats = [{ id: cid, title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
        box.activeChatId = cid
      }
      if (!box.activeChatId || !box.chats.some((c: any) => String(c.id) === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
    }

    const targetKind0 = String((d.ui as any).activeTargetKind || '').trim()
    const targetKind = targetKind0 === 'group' ? 'group' : 'role'
    ;(d.ui as any).activeTargetKind = targetKind

    const activeRoleId = String(d.ui.activeRoleId || '')
    if (!activeRoleId || !d.roles.some((r) => String(r?.id) === activeRoleId)) d.ui.activeRoleId = String(d.roles[0]?.id || '')

    const activeGroupId = String((d.ui as any).activeGroupId || '').trim()
    if (activeGroupId && !(d as any).groups.some((g: any) => String(g?.id || '') === activeGroupId)) (d.ui as any).activeGroupId = ''

    const hasGroups = !!((d as any).groups && (d as any).groups.length)
    if (targetKind === 'group' && !hasGroups) (d.ui as any).activeTargetKind = 'role'

    return d
  }

  if (runtime === 'background') {
    backgroundMain().catch(() => {})
    return
  }

  async function saveMetaOnly() {
    if (!state.data) return
    // meta 里保存 UI（activeRoleId）和 settings；不要每次都重写所有 role/chat 文件。
    state.data.ui.activeRoleId = String(state.draft.activeRoleId || '')
    ;(state.data.ui as any).activeGroupId = String(state.draft.activeGroupId || '')
    ;(state.data.ui as any).activeTargetKind = String(state.draft.activeTargetKind || '') === 'group' ? 'group' : 'role'

    const old = splitMetaCache || (await loadSplitMeta())
    if (!old) return saveSplitData(state.data)

    const settingsMeta = state.data.settings && typeof state.data.settings === 'object' ? { ...(state.data.settings as any) } : {}
    try {
      delete (settingsMeta as any).stickers
    } catch (_) {}

    const meta = {
      ...(old && typeof old === 'object' ? old : {}),
      schemaVersion: SPLIT_SCHEMA_VERSION,
      dataVersion: VERSION,
      updatedAt: now(),
      ui: state.data.ui && typeof state.data.ui === 'object' ? state.data.ui : {},
      settings: settingsMeta,
    }

    await api.storage.set(SPLIT_META_KEY, meta)
    splitMetaCache = meta
  }

  async function load() {
    try {
      await ensureSplitStoreReady()
      const split = await loadSplitData()
      if (!split) throw new Error('存储未初始化')
      state.data = split
      state.draft.activeRoleId = String(state.data?.ui?.activeRoleId || '')
      state.draft.activeGroupId = String((state.data?.ui as any)?.activeGroupId || '')
      state.draft.activeTargetKind = String((state.data?.ui as any)?.activeTargetKind || 'role') === 'group' ? 'group' : 'role'
    } catch (e) {
      state.data = null
      state.draft.activeRoleId = ''
      state.draft.activeGroupId = ''
      state.draft.activeTargetKind = 'role'
      api.ui?.showToast?.(String(e?.message || e || '加载失败'))
    } finally {
      state.loading = false
    }
  }

  async function save() {
    if (!state.data) return
    state.data.ui.activeRoleId = String(state.draft.activeRoleId || '')
    ;(state.data.ui as any).activeGroupId = String(state.draft.activeGroupId || '')
    ;(state.data.ui as any).activeTargetKind = String(state.draft.activeTargetKind || '') === 'group' ? 'group' : 'role'
    await saveSplitData(state.data)
  }

  function getProvider(pid) {
    const ps = state.data?.settings?.providers
    if (!Array.isArray(ps)) return null
    return ps.find((p) => String(p?.id) === String(pid)) || null
  }

  function getRoleById(roleId: any) {
    const rid = String(roleId || '').trim()
    if (!rid) return null
    const roles = state.data?.roles
    if (!Array.isArray(roles)) return null
    return roles.find((r: any) => String(r?.id || '') === rid) || null
  }

  function getGroupById(groupId: any) {
    const gid = String(groupId || '').trim()
    if (!gid) return null
    const groups = (state.data as any)?.groups
    if (!Array.isArray(groups)) return null
    return groups.find((g: any) => String(g?.id || '') === gid) || null
  }

  function activeTargetKind() {
    const k = String((state.draft as any)?.activeTargetKind || (state.data?.ui as any)?.activeTargetKind || 'role').trim()
    return k === 'group' ? 'group' : 'role'
  }

  function activeRole() {
    const rid = String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '')
    return getRoleById(rid)
  }

  function activeGroup() {
    const gid = String((state.draft as any).activeGroupId || (state.data?.ui as any)?.activeGroupId || '')
    return getGroupById(gid)
  }

  function activeChatFromData() {
    if (!state.data) return null
    const kind = activeTargetKind()
    if (kind === 'group') {
      const g = activeGroup()
      if (!g) return null
      const box = (state.data as any).chatsByGroup?.[String(g.id)]
      if (!box) return null
      const activeChatId = String(box.activeChatId || '')
      const chats = Array.isArray(box.chats) ? box.chats : []
      return chats.find((c: any) => String(c?.id) === activeChatId) || chats[0] || null
    }

    const r = activeRole()
    if (!r) return null
    const box = state.data.chatsByRole?.[String(r.id)]
    if (!box) return null
    const activeChatId = String(box.activeChatId || '')
    const chats = Array.isArray(box.chats) ? box.chats : []
    return chats.find((c) => String(c?.id) === activeChatId) || chats[0] || null
  }

  function activeChat() {
    const kind = activeTargetKind()
    if (kind === 'group') {
      const g = activeGroup()
      const gid = String(g?.id || '')
      const pending = (state as any).pendingGroupChat
      if (pending && String(pending.groupId || '') === gid && pending.chat) return pending.chat
      return activeChatFromData()
    }

    const role = activeRole()
    const rid = String(role?.id || '')
    const pending = state.pendingChat
    if (pending && String(pending.roleId || '') === rid && pending.chat) return pending.chat
    return activeChatFromData()
  }

  function clearPendingChat() {
    state.pendingChat = null
  }

  function clearPendingGroupChat() {
    ;(state as any).pendingGroupChat = null
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
    const activeId = String(state.data?.settings?.toolRequestRenderPreset || 'classic')
    const userPresets = (state.data?.settings as any)?.toolRequestRenderPresets
    const resolved = resolveToolRequestRenderPreset(activeId, userPresets)
    renderAssistantIntoRaw(el, text, {
      stickersEnabled: enabled,
      getStickerPath: getStickerRelPath,
      toolRequestPreset: resolved,
    })
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
    const scale = clamp(state.mermaid.scale, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
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

    if (typeof api?.net?.request !== 'function') throw new Error('未授权：net.request')

    const messages = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    if (userParts) {
      messages.push({ role: 'user', content: userParts })
    } else if (userMessages) {
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

  async function touchGroupChatUpdatedAt(groupId: any, chatId: any, updatedAt: any) {
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    const ua0 = Number(updatedAt || 0)
    if (!gid || !cid) return

    await withSplitMetaWrite(async () => {
      const meta = (await loadSplitMeta()) || splitMetaCache
      if (!meta) return
      const idx = (meta as any).chatIndexByGroup?.[gid]
      if (!idx || typeof idx !== 'object') return
      if (!(idx as any).chatUpdatedAt || typeof (idx as any).chatUpdatedAt !== 'object') (idx as any).chatUpdatedAt = {}
      ;(idx as any).chatUpdatedAt[String(cid)] = ua0 > 0 ? ua0 : now()
      meta.updatedAt = now()
      await api.storage.set(SPLIT_META_KEY, meta)
      splitMetaCache = meta
    })
  }

  const chatTitleNamingWriteQueue = new Map<string, Promise<void>>()

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

  function enqueueChatTitleNamingWrite(roleId, chatId, fn) {
    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    if (!rid || !cid) return Promise.reject(new Error('未找到会话ID'))
    const key = `role:${rid}:${cid}`
    return enqueueChatTitleNamingWriteKey(key, fn)
  }

  function normalizeAiGeneratedChatTitle(input) {
    let s = String(input || '')
      .replace(/\r\n/g, '\n')
      .replace(/\s+\n/g, '\n')
      .trim()

    // 只取第一行有效文本：避免模型输出多行说明。
    const lines = s.split('\n').map((x) => String(x || '').trim()).filter((x) => !!x)
    s = String(lines[0] || '').trim()

    // 去掉常见前缀与引号
    s = s.replace(/^(标题|会话标题|建议标题)\s*[:：]\s*/i, '').trim()
    s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim()

    // 统一空白
    s = s.replace(/\s+/g, ' ').trim()
    if (s.length > 80) s = s.slice(0, 80).trim()
    return s
  }

  function buildChatTranscriptForTitle(chat, maxTurns = 24) {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : []
    const his = limitHistory(msgs, clamp(Math.round(Number(maxTurns || 0)), 2, 60))
    const parts = []

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

  async function aiGenerateChatTitle(roleId, chatId) {
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

    const box = ensureChatsBoxBare(rid)
    if (!box) throw new Error('角色不存在')
    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((c) => String(c?.id || '') === cid) || null
    if (!chat) throw new Error('会话不存在')
    if (chatHasPendingAssistant(chat)) throw new Error('会话正在生成中，请稍后再试')

    const userContent = buildChatTranscriptForTitle(chat, 24)
    if (!userContent) throw new Error('聊天记录为空，无法生成标题')

    return enqueueChatTitleNamingWrite(rid, cid, async () => {
      const reply = await requestOpenAiChatOnce({ providerId, modelId, systemPrompt, userContent })
      const title = normalizeAiGeneratedChatTitle(reply)
      if (!title) throw new Error('AI 未返回标题')
      renameChatTitle(rid, cid, title)
      return title
    })
  }

  async function aiGenerateGroupChatTitle(groupId: any, chatId: any) {
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

    const box = ensureGroupChatsBoxBare(gid)
    if (!box) throw new Error('群组不存在')
    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((c: any) => String(c?.id || '') === cid) || null
    if (!chat) throw new Error('会话不存在')
    if (chatHasPendingAssistant(chat)) throw new Error('会话正在生成中，请稍后再试')

    const userContent = buildChatTranscriptForTitle(chat, 24)
    if (!userContent) throw new Error('聊天记录为空，无法生成标题')

    const key = `group:${gid}:${cid}`
    return enqueueChatTitleNamingWriteKey(key, async () => {
      const reply = await requestOpenAiChatOnce({ providerId, modelId, systemPrompt, userContent })
      const title = normalizeAiGeneratedChatTitle(reply)
      if (!title) throw new Error('AI 未返回标题')
      renameGroupChatTitle(gid, cid, title)
      return title
    })
  }

  const stickerNamingWriteQueue = new Map<string, Promise<void>>()

  function enqueueStickerNamingWrite(categoryName, stickerName, fn) {
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

  function normalizeAiGeneratedStickerName(input) {
    let s = String(input || '')
      .replace(/\r\n/g, '\n')
      .trim()

    const lines = s.split('\n').map((x) => String(x || '').trim()).filter((x) => !!x)
    s = String(lines[0] || '').trim()

    s = s.replace(/^(名称|表情名|建议名称|建议表情名)\s*[:：]\s*/i, '').trim()
    s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim()
    s = s.replace(/[\/\\\]\r\n]/g, '_').trim()
    s = s.replace(/\s+/g, ' ').trim()
    if (s.length > 80) s = s.slice(0, 80).trim()
    return s
  }

  async function aiGenerateStickerName(categoryName, stickerName) {
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

    if (typeof api?.files?.images?.read !== 'function') throw new Error('未授权：files.images.read')
    const imgUrl = await api.files.images.read({ scope: 'data', path: relPath }).catch(() => '')
    const url = String(imgUrl || '').trim()
    if (!url) throw new Error('读取表情包图片失败')

    return enqueueStickerNamingWrite(cat, oldName, async () => {
      const userText =
        `请根据这张表情包图片取一个简短中文名字，用作 token [[sticker:${cat}/名称]] 的“名称”。\n` +
        `限制：不要包含 / 或 \\\\ 或 ] 或换行；只输出名字本身。\n` +
        `当前分类：${cat}\n当前名称：${oldName}`

      const reply = await requestOpenAiChatOnce({
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

      if (!state.data) throw new Error('数据未加载')
      if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') throw new Error('表情包配置不存在')
      const st2 = state.data.settings.stickers as any
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

  type DraftFileKind = 'txt' | 'md' | 'pdf' | 'docx' | 'ppt'
  type DraftFileItem = {
    id: string
    name: string
    size: number
    kind: DraftFileKind
    pending: boolean
    text: string
    sendPct: number
    error: string
  }

  type ChatAttachmentItem = {
    id: string
    name: string
    kind: DraftFileKind
    lang: string
    text: string
    fullLen: number
    sendLen: number
    sendPct: number
  }

  type ChatMsgGroupRole = '' | 'root' | 'attachment'

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
    if (ext === 'ppt' || ext === 'pptx') return 'ppt'
    const mime = String(file?.type || '').toLowerCase()
    if (mime === 'text/plain') return 'txt'
    if (mime === 'text/markdown') return 'md'
    if (mime === 'application/pdf') return 'pdf'
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
    if (mime === 'application/vnd.ms-powerpoint') return 'ppt'
    if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'ppt'
    return ''
  }

  function escapeFence(s: string) {
    // 避免把附件内容里的 ``` 意外当成代码块结束
    return String(s || '').replaceAll('```', '``\u200b`')
  }

  function buildUserTextForOpenAi(m: any) {
    let base = String(m?.content || '').trim()
    const atts = normalizeMessageAttachments(m?.attachments)
    if (!atts.length) return base

    if (atts.length === 1) {
      const n = String(atts[0]?.name || '')
      const defaultLabel = n ? `附件：${n}` : ''
      if (defaultLabel && base === defaultLabel) base = ''
    }

    const blocks = []
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

  function addDraftFilePlaceholder(file: File, kind: DraftFileKind): DraftFileItem | null {
    if (!Array.isArray(state.draft.files)) state.draft.files = []
    if (state.draft.files.length >= MAX_DRAFT_FILES) return null
    const it: DraftFileItem = {
      id: uid('f'),
      name: String(file?.name || '文件'),
      size: clamp(Number(file?.size || 0), 0, Number.MAX_SAFE_INTEGER),
      kind,
      pending: true,
      text: '',
      sendPct: 100,
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
    const mb0 = (() => {
      try {
        const at = state.data?.settings?.attachments
        const map = at && typeof at === 'object' ? (at as any).maxFileSizeMbByKind : null
        return map && typeof map === 'object' ? map[kind] : undefined
      } catch (_) {
        return undefined
      }
    })()
    const maxMb = (() => {
      const n = Number(mb0)
      if (!isFinite(n)) return DEFAULT_ATTACH_MAX_FILE_MB
      return clamp(Math.round(n), 0, MAX_ATTACH_MAX_FILE_MB)
    })()
    const maxBytes = maxMb <= 0 ? 0 : maxMb * 1024 * 1024
    if (maxBytes > 0 && size > maxBytes) {
      const curMb = Math.round((size / 1024 / 1024) * 10) / 10
      api.ui?.showToast?.(`提示：${String(file?.name || '文件')} 大小 ${curMb}MB 超过设置阈值 ${maxMb}MB，仍会尝试解析`)
    }
    if (kind === 'txt' || kind === 'md') {
      const t = await file.text()
      return String(t || '').trim()
    }
    if (kind === 'pdf') {
      return await extractPdfText(file)
    }
    if (kind === 'docx') {
      const t = await extractDocxText(file)
      return String(t || '').trim()
    }
    if (kind === 'ppt') {
      const t = await extractPptMarkdown(file)
      return String(t || '').trim()
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
          cur.text = String(r || '')
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

  async function sendChat(opts?: { forkFromMid?: string }) {
    if (state.sending || state.loading || !state.data) return

    if (activeTargetKind() === 'group') {
      await sendGroupChat(opts)
      return
    }

    const role = activeRole()
    if (!role) return
    ensureRoleDefaults(role)

    const input = String(state.draft.input || '').trim()
    const draftImages = Array.isArray(state.draft.images) ? state.draft.images : []
    const draftFiles: DraftFileItem[] = Array.isArray((state.draft as any).files) ? ((state.draft as any).files as any[]) : []
    const hasFiles = draftFiles.length > 0
    if (!input && !draftImages.length && !hasFiles) return api.ui?.showToast?.('输入不能为空')
    if (hasFiles && draftFiles.some((x: any) => !!x?.pending)) return api.ui?.showToast?.('文件解析中，请稍候…')
    // 超阈值仅提醒：由 UI 在发送时二次确认；这里不强行阻止。

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

      const branching = ensureChatBranching(chat)
      let activeBranchId = normalizeBranchId((branching as any)?.activeBranchId || CHAT_DEFAULT_BRANCH_ID)
      const activeBranch = ensureChatBranch(chat, activeBranchId)
      let parentMid = String(activeBranch?.headMid || '').trim()

      const rid2 = String(role.id || '')
      const draft0 = state.branchDraft && typeof state.branchDraft === 'object' ? (state.branchDraft as any) : null
      const draft =
        draft0 && String(draft0?.roleId || '') === rid2 && String(draft0?.chatId || '') === String(chat.id || '') ? draft0 : null

      const forkOverride = !draft ? String(opts?.forkFromMid || '').trim() : ''

      let draftForkMid = ''
      let draftNewBranchId = ''
      if (draft || forkOverride) {
        draftForkMid = String((draft ? draft?.forkFromMid : forkOverride) || '').trim()
        if (!draftForkMid) throw new Error('分支草稿无效（缺少基点）')
        const items0 = Array.isArray(chat.messages) ? chat.messages : []
        const ok = items0.some((m: any) => String(m?.id || '') === draftForkMid)
        if (!ok) throw new Error('分支草稿无效（基点消息不存在）')

        draftNewBranchId = genUniqueBranchId(branching)
        activeBranchId = draftNewBranchId
        parentMid = draftForkMid
      } else if (!parentMid) {
        const items0 = Array.isArray(chat.messages) ? chat.messages : []
        parentMid = items0.length ? String(items0[items0.length - 1]?.id || '') : ''
      }

      const wasEmpty = !Array.isArray(chat.messages) || chat.messages.length === 0
      const userText = String(input || '').trim()
      const hasUserMain = !!userText || savedPaths.length > 0

      const groupId = hasFiles ? uid('g') : ''
      const rootMid = uid('m')

      const attachMsgs: any[] = []
      if (hasFiles) {
        for (const f of draftFiles) {
          if (!f || f.pending) continue
          if (String(f?.error || '')) continue
          const name = String(f?.name || '文件')
          const kind = String(f?.kind || 'txt') as DraftFileKind
          const lang = kind === 'md' || kind === 'ppt' ? 'markdown' : 'text'
          const raw = String(f?.text || '').trim()
          const fullLen = raw.length
          if (!raw) continue

          const pct0 = Math.round(Number(f?.sendPct ?? 100))
          const pct = clamp(pct0, 0, 100)
          const sendLen = Math.max(0, Math.ceil((fullLen * pct) / 100))
          const snippetRaw = sendLen >= fullLen ? raw : raw.slice(0, sendLen).trimEnd()
          if (!snippetRaw.trim()) continue

          const att: ChatAttachmentItem = {
            id: uid('att'),
            name,
            kind,
            lang,
            text: snippetRaw,
            fullLen,
            sendLen,
            sendPct: pct,
          }
          const mid = uid('m')
          attachMsgs.push({
            id: mid,
            role: 'user',
            content: `附件：${name}`,
            attachments: [att],
            groupId,
            groupRole: 'attachment' as ChatMsgGroupRole,
            groupParentMid: rootMid,
            branchId: activeBranchId,
            parentMid,
            createdAt: now(),
          })
          parentMid = mid
        }
      }

      if (!hasUserMain && !attachMsgs.length) throw new Error('没有可发送的内容（文件解析失败或为空）')

      const rootMsg: any = {
        id: rootMid,
        role: 'user',
        content: hasUserMain ? userText : attachMsgs.length ? '（附件）' : userText,
        images: savedPaths,
        branchId: activeBranchId,
        parentMid,
        createdAt: now(),
      }
      if (attachMsgs.length) {
        rootMsg.groupId = groupId
        rootMsg.groupRole = 'root' as ChatMsgGroupRole
        rootMsg.groupParentMid = ''
      }
      parentMid = rootMid

      if (draftNewBranchId && draftForkMid) {
        const t = now()
        const branches = Array.isArray((branching as any).branches) ? (branching as any).branches : []
        branches.push({
          id: draftNewBranchId,
          name: '分支',
          headMid: draftForkMid,
          createdAt: t,
          updatedAt: t,
          forkFromMid: draftForkMid,
        })
        ;(branching as any).branches = branches.slice(0, 200)
        ;(branching as any).activeBranchId = draftNewBranchId
        ;(chat as any).branching = branching
      }

      chat.messages.push(...attachMsgs, rootMsg)
      chat.updatedAt = now()
      if (wasEmpty && String(chat.title || '') === '新聊天') {
        const t = userText.replace(/\s+/g, ' ').trim()
        const firstAttName = attachMsgs.length ? String((attachMsgs[0] as any)?.attachments?.[0]?.name || '').trim() : ''
        const base = t || (savedPaths.length ? '图片' : firstAttName || (hasFiles ? '文件' : '新聊天'))
        chat.title = base.length > 16 ? base.slice(0, 16) + '…' : base || '新聊天'
      }

      state.draft.input = ''
      state.draft.images = []
      ;(state.draft as any).files = []
      if (draft && draftNewBranchId && draftForkMid) state.branchDraft = null

      chat.messages.push({
        id: assistantMid,
        role: 'assistant',
        content: '（生成中…）',
        branchId: activeBranchId,
        parentMid,
        pending: true,
        streaming: streamEnabled,
        createdAt: now(),
      })
      chat.updatedAt = now()
      setChatBranchHeadMid(chat, activeBranchId, assistantMid)
      repairChatLinearBranching(chat)

      const jobId = uid('job')
      const job = {
        id: jobId,
        kind: 'openai.chat.completions',
        status: 'queued',
        createdAt: now(),
        roleId: String(role.id || ''),
        chatId: String(chat.id || ''),
        assistantMid,
        branchId: activeBranchId,
        stream: streamEnabled,
      }

      await save()
      await runtimeStorage.set(jobKey(jobId), job)
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

  async function sendGroupChat(_opts?: { forkFromMid?: string }) {
    if (state.sending || state.loading || !state.data) return

    const group = activeGroup()
    if (!group) return api.ui?.showToast?.('请先选择群组')
    const gid = String((group as any).id || '').trim()
    if (!gid) return api.ui?.showToast?.('群组无效')

    const roles = Array.isArray(state.data.roles) ? state.data.roles : []
    const roleById = new Map<string, any>()
    for (const r of roles) {
      const rid = String(r?.id || '').trim()
      if (!rid || roleById.has(rid)) continue
      roleById.set(rid, r)
    }

    const member0 = Array.isArray((group as any).memberRoleIds) ? (group as any).memberRoleIds : []
    const memberRoleIds = member0.map((x: any) => String(x || '').trim()).filter((x: any) => !!x && roleById.has(x)).slice(0, 50)
    if (!memberRoleIds.length) return api.ui?.showToast?.('该群组还没有成员角色')

    const input = String(state.draft.input || '').trim()
    const draftImages = Array.isArray(state.draft.images) ? state.draft.images : []
    const draftFiles: DraftFileItem[] = Array.isArray((state.draft as any).files) ? ((state.draft as any).files as any[]) : []
    const hasFiles = draftFiles.length > 0
    if (!input && !draftImages.length && !hasFiles) return api.ui?.showToast?.('输入不能为空')
    if (hasFiles && draftFiles.some((x: any) => !!x?.pending)) return api.ui?.showToast?.('文件解析中，请稍候…')

    const mode = String((group as any).mode || '').trim() === 'random' ? 'random' : 'roundRobin'

    const pickRandomRolesOnce = () => {
      const randomCfg = (group as any).random && typeof (group as any).random === 'object' ? (group as any).random : {}
      const weights0 = (randomCfg as any).weightsByRoleId && typeof (randomCfg as any).weightsByRoleId === 'object' ? (randomCfg as any).weightsByRoleId : {}
      let minCount = Number((randomCfg as any).minCount ?? 1)
      let maxCount = Number((randomCfg as any).maxCount ?? 2)
      if (!isFinite(minCount)) minCount = 1
      if (!isFinite(maxCount)) maxCount = 2
      minCount = clamp(Math.round(minCount), 1, 20)
      maxCount = clamp(Math.round(maxCount), 1, 20)
      if (maxCount < minCount) maxCount = minCount

      const pool = memberRoleIds
        .map((rid) => {
          const w = Number((weights0 as any)[rid] ?? 1)
          const weight = isFinite(w) && w >= 0 ? w : 1
          return { rid, weight }
        })
        .filter((x) => x.weight > 0)

      const candidates = pool.length ? pool.slice() : memberRoleIds.map((rid) => ({ rid, weight: 1 }))
      const maxK = Math.max(1, Math.min(candidates.length, maxCount))
      const minK = Math.max(1, Math.min(maxK, minCount))
      const k = minK + Math.floor(Math.random() * (maxK - minK + 1))

      const chosen: string[] = []
      const bag = candidates.slice()
      for (let i = 0; i < k && bag.length; i++) {
        let sum = 0
        for (const it of bag) sum += it.weight
        if (!(sum > 0)) break
        let r = Math.random() * sum
        let idx = -1
        for (let j = 0; j < bag.length; j++) {
          r -= bag[j].weight
          if (r <= 0) {
            idx = j
            break
          }
        }
        if (idx < 0) idx = bag.length - 1
        const picked = bag.splice(idx, 1)[0]
        if (picked?.rid) chosen.push(String(picked.rid))
      }
      return chosen.length ? chosen : memberRoleIds.slice(0, 1)
    }

    const speakerRoleIds = (() => {
      if (mode === 'random') return pickRandomRolesOnce()
      const order0 = Array.isArray((group as any).roundRobinOrder) ? (group as any).roundRobinOrder : []
      const order = order0.map((x: any) => String(x || '').trim()).filter((x: any) => !!x && memberRoleIds.includes(x))
      return order.length ? order : memberRoleIds.slice()
    })()

    let chat: any = null
    let assistantMids: Array<{ roleId: string; mid: string }> = []

    try {
      if (draftImages.length && typeof api?.files?.images?.writeBase64 !== 'function') {
        return api.ui?.showToast?.('未授权：files.images.writeBase64')
      }

      state.sending = true
      renderComposer()

      // 校验每个参与发言的角色是否可用（避免落盘后才报错）
      for (const rid of speakerRoleIds) {
        const r = roleById.get(String(rid || ''))
        if (!r) throw new Error('群组成员角色不存在')
        ensureRoleDefaults(r)
        const picked = pickChatModelRef(r, null)
        const providerId = String(picked.providerId || '')
        const modelId = String(picked.modelId || '').trim()
        const p = getProvider(providerId)
        if (!p) throw new Error(`未找到供应商：${String((r as any).name || '角色')}`)
        const baseUrl = trimSlash(p.baseUrl || '')
        const apiKey = String(p.apiKey || '').trim()
        if (!isHttpBaseUrl(baseUrl)) throw new Error(`请先为「${String((r as any).name || '角色')}」配置 Base URL（http/https）`)
        if (!apiKey) throw new Error(`请先为「${String((r as any).name || '角色')}」配置 API Key`)
        if (!modelId) throw new Error(`请先为「${String((r as any).name || '角色')}」选择模型ID`)
      }

      const savedPaths: string[] = []
      for (const img of draftImages.slice(0, MAX_DRAFT_IMAGES)) {
        const dataUrl = String(img?.dataUrl || '')
        if (!looksLikeImageDataUrl(dataUrl)) continue
        const saved = await api.files.images.writeBase64({ scope: 'data', dataUrlOrBase64: dataUrl })
        const path = String(saved || '').trim()
        if (path) savedPaths.push(path)
      }

      const streamEnabled = !!state.data?.settings?.streamEnabled

      const pending = (state as any).pendingGroupChat
      if (pending && String(pending.groupId || '') === gid && pending.chat) {
        chat = createChatForGroup(gid)
        clearPendingGroupChat()
      } else {
        if (!(state.data as any).chatsByGroup || typeof (state.data as any).chatsByGroup !== 'object') (state.data as any).chatsByGroup = {}
        if (!(state.data as any).chatsByGroup[gid] || typeof (state.data as any).chatsByGroup[gid] !== 'object')
          (state.data as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
        const box = (state.data as any).chatsByGroup[gid]
        if (!Array.isArray(box.chats)) box.chats = []
        box.activeChatId = String(box.activeChatId || '')
        if (!box.chats.length) {
          const cid = uid('gc')
          const t = now()
          box.chats = [{ id: cid, title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
          box.activeChatId = cid
        }
        if (!box.activeChatId || !box.chats.some((c: any) => String(c?.id || '') === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
        chat = box.chats.find((c: any) => String(c?.id || '') === String(box.activeChatId || '')) || box.chats[0] || null
      }
      if (!chat) throw new Error('创建会话失败')
      if (chatHasPendingAssistant(chat)) throw new Error('该会话正在生成中，请先停止或等待完成')

      const branching = ensureChatBranching(chat)
      const activeBranchId = normalizeBranchId((branching as any)?.activeBranchId || CHAT_DEFAULT_BRANCH_ID)
      const activeBranch = ensureChatBranch(chat, activeBranchId)
      let parentMid = String(activeBranch?.headMid || '').trim()
      if (!parentMid) {
        const items0 = Array.isArray(chat.messages) ? chat.messages : []
        parentMid = items0.length ? String(items0[items0.length - 1]?.id || '') : ''
      }

      const wasEmpty = !Array.isArray(chat.messages) || chat.messages.length === 0
      const userText = String(input || '').trim()
      const hasUserMain = !!userText || savedPaths.length > 0

      const attachGroupId = hasFiles ? uid('g') : ''
      const rootMid = uid('m')

      const attachMsgs: any[] = []
      if (hasFiles) {
        for (const f of draftFiles) {
          if (!f || f.pending) continue
          if (String(f?.error || '')) continue
          const name = String(f?.name || '文件')
          const kind = String(f?.kind || 'txt') as DraftFileKind
          const lang = kind === 'md' || kind === 'ppt' ? 'markdown' : 'text'
          const raw = String(f?.text || '').trim()
          const fullLen = raw.length
          if (!raw) continue

          const pct0 = Math.round(Number(f?.sendPct ?? 100))
          const pct = clamp(pct0, 0, 100)
          const sendLen = Math.max(0, Math.ceil((fullLen * pct) / 100))
          const snippetRaw = sendLen >= fullLen ? raw : raw.slice(0, sendLen).trimEnd()
          if (!snippetRaw.trim()) continue

          const att: ChatAttachmentItem = {
            id: uid('att'),
            name,
            kind,
            lang,
            text: snippetRaw,
            fullLen,
            sendLen,
            sendPct: pct,
          }
          const mid = uid('m')
          attachMsgs.push({
            id: mid,
            role: 'user',
            content: `附件：${name}`,
            attachments: [att],
            groupId: attachGroupId,
            groupRole: 'attachment' as ChatMsgGroupRole,
            groupParentMid: rootMid,
            branchId: activeBranchId,
            parentMid,
            createdAt: now(),
          })
          parentMid = mid
        }
      }

      if (!hasUserMain && !attachMsgs.length) throw new Error('没有可发送的内容（文件解析失败或为空）')

      const rootMsg: any = {
        id: rootMid,
        role: 'user',
        content: hasUserMain ? userText : attachMsgs.length ? '（附件）' : userText,
        images: savedPaths,
        branchId: activeBranchId,
        parentMid,
        createdAt: now(),
      }
      if (attachMsgs.length) {
        rootMsg.groupId = attachGroupId
        rootMsg.groupRole = 'root' as ChatMsgGroupRole
        rootMsg.groupParentMid = ''
      }
      parentMid = rootMid

      chat.messages.push(...attachMsgs, rootMsg)
      chat.updatedAt = now()
      if (wasEmpty && String(chat.title || '') === '群聊') {
        const t = userText.replace(/\s+/g, ' ').trim()
        chat.title = t ? (t.length > 16 ? t.slice(0, 16) + '…' : t) : '群聊'
      }

      state.draft.input = ''
      state.draft.images = []
      ;(state.draft as any).files = []

      assistantMids = []
      for (const rid of speakerRoleIds) {
        const mid = uid('m')
        assistantMids.push({ roleId: String(rid || ''), mid })
        chat.messages.push({
          id: mid,
          role: 'assistant',
          speakerRoleId: String(rid || ''),
          content: '（生成中…）',
          branchId: activeBranchId,
          parentMid,
          pending: true,
          streaming: streamEnabled,
          createdAt: now(),
        })
        parentMid = mid
      }

      chat.updatedAt = now()
      if (assistantMids.length) setChatBranchHeadMid(chat, activeBranchId, assistantMids[assistantMids.length - 1].mid)
      repairChatLinearBranching(chat)

      await save()

      for (const it of assistantMids) {
        const jobId = uid('job')
        const job = {
          id: jobId,
          kind: 'openai.chat.completions',
          status: 'queued',
          createdAt: now(),
          targetKind: 'group',
          groupId: gid,
          roleId: String(it.roleId || ''),
          chatId: String(chat.id || ''),
          assistantMid: String(it.mid || ''),
          branchId: activeBranchId,
          stream: streamEnabled,
        }
        await runtimeStorage.set(jobKey(jobId), job)
        await enqueueJob(jobId)
      }
    } catch (e) {
      const msg = String((e as any)?.message || e || '请求失败')
      const items = Array.isArray(chat?.messages) ? chat.messages : []
      for (const it of assistantMids) {
        const am = it?.mid ? items.find((m: any) => String(m?.id || '') === String(it.mid || '')) : null
        if (!am) continue
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

    const kind = activeTargetKind()
    const roleId = String(activeRole()?.id || '')
    const groupId = String((activeGroup() as any)?.id || '')
    const chatId = String(activeChatFromData()?.id || '')
    if (!state.data || !chatId || (kind === 'role' && !roleId) || (kind === 'group' && !groupId)) return

    const chat = kind === 'group' ? findGroupChatByIds(groupId, chatId) : findChatByIds(roleId, chatId)
    if (!chat) return

    const lastPending = findLastPendingAssistant(chat)
    const mid = String(lastPending?.id || '')
    if (!mid) return api.ui?.showToast?.('当前会话没有正在生成的消息')

    try {
      await runtimeStorage.set(cancelMidKey(mid), { requestedAt: now() })
    } catch (_) {}

    if (state.data && chatId && mid && (kind === 'role' ? roleId : groupId)) {
      let text = ''
      try {
        const s = await runtimeStorage.get(streamKey(mid))
        text = String(s?.text || '')
      } catch (_) {}

      const msgs = Array.isArray(chat?.messages) ? chat.messages : []
      const m = msgs.find((x) => String(x?.id || '') === mid) || null
      if (!text) {
        try {
          const cached = (uiStreamCache as any)?.get?.(mid)
          if (typeof cached === 'string' && cached) text = cached
        } catch (_) {}
      }
      if (!text && m) {
        const cur = String((m as any)?.content || '').trim()
        if (cur && cur !== '（生成中…）') text = cur
      }
      const finalOut = text || '（已停止）'
      if (m) {
        m.content = finalOut
        m.pending = false
        m.streaming = false
      }
      if (chat) {
        chat.updatedAt = now()
        repairChatLinearBranching(chat)
      }
      emit()
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

      let userMid = String((target as any)?.parentMid || '').trim()
      let userMsg = userMid ? msgs.find((m) => String(m?.id || '') === userMid) || null : null
      if (!userMsg || userMsg.role !== 'user') {
        // 兼容旧数据：没有 parentMid 时退回到“向前找最近 user”
        let userIndex = -1
        for (let i = aiIndex - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m && m.role === 'user') {
            userIndex = i
            break
          }
        }
        if (userIndex < 0) throw new Error('未找到对应的用户消息')
        userMsg = msgs[userIndex]
        userMid = String(userMsg?.id || '').trim()
      }

      const streamEnabled = !!state.data?.settings?.streamEnabled
      target.content = '（生成中…）'
      target.pending = true
      target.streaming = streamEnabled
      chat.updatedAt = now()
      repairChatLinearBranching(chat)

      try {
        await runtimeStorage.remove(streamKey(mid))
      } catch (_) {}

      const jobId = uid('job')
      const branching = ensureChatBranching(chat)
      const activeBranchId = normalizeBranchId((branching as any)?.activeBranchId || CHAT_DEFAULT_BRANCH_ID)
      const branchId = normalizeBranchId((target as any)?.branchId || activeBranchId)
      const job = {
        id: jobId,
        kind: 'openai.chat.completions',
        status: 'queued',
        createdAt: now(),
        roleId: String(role.id || ''),
        chatId: String(chat.id || ''),
        assistantMid: mid,
        cutoffMid: mid,
        branchId,
        stream: streamEnabled,
      }

      await save()
      await runtimeStorage.set(jobKey(jobId), job)
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
      const branching = ensureChatBranching(chat)
      const activeBranchId = normalizeBranchId((branching as any)?.activeBranchId || CHAT_DEFAULT_BRANCH_ID)
      assistantMid = uid('m')
      msgs.splice(userIndex + 1, 0, {
        id: assistantMid,
        role: 'assistant',
        content: '（生成中…）',
        branchId: activeBranchId,
        parentMid: mid,
        pending: true,
        streaming: streamEnabled,
        createdAt: now(),
      })
      chat.messages = msgs
      chat.updatedAt = now()
      setChatBranchHeadMid(chat, activeBranchId, assistantMid)
      repairChatLinearBranching(chat)

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
        branchId: activeBranchId,
        stream: streamEnabled,
      }

      await save()
      await runtimeStorage.set(jobKey(jobId), job)
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

  async function createParallelBranchFromAssistantMessage(assistantMid) {
    if (state.sending || state.loading || !state.data) return

    const role = activeRole()
    const chat = activeChatFromData()
    if (!role || !chat) return
    ensureRoleDefaults(role)

    const mid = String(assistantMid || '').trim()
    if (!mid) return

    if (chatHasPendingAssistant(chat)) return api.ui?.showToast?.('该会话正在生成中，请先停止或等待完成')

    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const target = msgs.find((m) => String(m?.id || '') === mid) || null
    if (!target || target.role !== 'assistant') return api.ui?.showToast?.('只能从 AI 消息新建分支')
    if (target.pending) return api.ui?.showToast?.('该消息正在生成中')

    const userMid0 = String((target as any)?.parentMid || '').trim()
    const userMsg = userMid0 ? msgs.find((m) => String(m?.id || '') === userMid0) || null : null
    if (!userMsg || userMsg.role !== 'user') return api.ui?.showToast?.('未找到对应的用户消息')

    let prevAiMid = ''
    const p0 = String((userMsg as any)?.parentMid || '').trim()
    const pMsg = p0 ? msgs.find((m) => String(m?.id || '') === p0) || null : null
    if (pMsg && pMsg.role === 'assistant') prevAiMid = String(pMsg.id || '')
    else {
      const idx = msgs.findIndex((m) => String(m?.id || '') === userMid0)
      for (let i = idx - 1; i >= 0; i--) {
        const m = msgs[i]
        if (m && m.role === 'assistant') {
          prevAiMid = String(m.id || '')
          break
        }
      }
    }

    if (!prevAiMid) return api.ui?.showToast?.('未找到上一条 AI 消息，无法新建分支')

    state.branchDraft = {
      roleId: String(role.id || ''),
      chatId: String(chat.id || ''),
      forkFromMid: prevAiMid,
      sourceAssistantMid: mid,
      createdAt: now(),
    }
    render()
    scrollToBottomSoon()
  }

  function switchBranchByAssistantSibling(assistantMid: any, delta: any) {
    if (state.loading || !state.data) return

    const chat = activeChatFromData()
    if (!chat) return

    const mid = String(assistantMid || '').trim()
    if (!mid) return

    const d = Math.sign(Number(delta || 0))
    if (!d) return

    const target = findChatMessageById(chat, mid)
    if (!target || String((target as any).role || '') !== 'assistant') return
    const prevAiMid = findPrevAssistantMidForAssistant(chat, mid)
    if (!prevAiMid) return

    const msgs = Array.isArray((chat as any)?.messages) ? (chat as any).messages : []
    const byId = new Map<string, any>()
    for (const m of msgs) {
      const id = String(m?.id || '').trim()
      if (!id || byId.has(id)) continue
      byId.set(id, m)
    }

    let sibs = msgs.filter((m: any) => {
      if (!m || m.role !== 'assistant') return false
      const userMid = String((m as any)?.parentMid || '').trim()
      if (!userMid) return false
      const u = byId.get(userMid) || null
      if (!u || u.role !== 'user') return false
      const p = String((u as any)?.parentMid || '').trim()
      if (!p) return false
      const pa = byId.get(p) || null
      if (!pa || pa.role !== 'assistant') return false
      return String(pa?.id || '').trim() === prevAiMid
    })

    if (sibs.length < 2) {
      const alt: any[] = []
      for (const m of msgs) {
        if (!m || m.role !== 'assistant') continue
        const id = String(m?.id || '').trim()
        if (!id) continue
        const p = findPrevAssistantMidForAssistant(chat, id)
        if (p && p === prevAiMid) alt.push(m)
        if (alt.length >= 80) break
      }
      sibs = alt
    }

    sibs.sort((a: any, b: any) => {
      const da = Number(a?.createdAt || 0)
      const db = Number(b?.createdAt || 0)
      if (da !== db) return da - db
      return String(a?.id || '').localeCompare(String(b?.id || ''))
    })

    if (sibs.length < 2) return

    const i0 = sibs.findIndex((m: any) => String(m?.id || '') === mid)
    if (i0 < 0) return

    const len = sibs.length
    const i = (i0 + d + len) % len
    const picked = sibs[i]
    const pickedMid = String(picked?.id || '').trim()
    const pickedBranchId = normalizeBranchId((picked as any)?.branchId || CHAT_DEFAULT_BRANCH_ID)
    if (!pickedMid || !pickedBranchId) return

    const branching = ensureChatBranching(chat)
    if (!branching) return
    ensureChatBranch(chat, pickedBranchId)
    ;(branching as any).activeBranchId = pickedBranchId
    ;(chat as any).branching = branching

    const b = findChatBranch(chat, pickedBranchId)
    if (b && !String((b as any)?.headMid || '').trim()) (b as any).headMid = pickedMid

    save().catch(() => {})
    const draft0 = state.branchDraft && typeof state.branchDraft === 'object' ? (state.branchDraft as any) : null
    if (draft0 && String(draft0?.roleId || '') === String(activeRole()?.id || '') && String(draft0?.chatId || '') === String(chat.id || '')) {
      state.branchDraft = null
    }
    render()
    scrollToBottomSoon()
  }

  function setActiveBranch(branchId: any) {
    if (state.loading || !state.data) return

    const chat = activeChatFromData()
    if (!chat) return

    const bid = normalizeBranchId(branchId || CHAT_DEFAULT_BRANCH_ID)
    const branching = ensureChatBranching(chat)
    if (!branching) return
    ensureChatBranch(chat, bid)
    ;(branching as any).activeBranchId = bid
    ;(chat as any).branching = branching

    const draft0 = state.branchDraft && typeof state.branchDraft === 'object' ? (state.branchDraft as any) : null
    if (draft0 && String(draft0?.roleId || '') === String(activeRole()?.id || '') && String(draft0?.chatId || '') === String(chat.id || '')) {
      state.branchDraft = null
    }

    save().catch(() => {})
    render()
    scrollToBottomSoon()
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

    const oldById = new Map<string, any>()
    for (const m of msgs) {
      const id = String(m?.id || '').trim()
      if (!id || oldById.has(id)) continue
      oldById.set(id, m)
    }

    const targetParentMid = String((target as any)?.parentMid || '').trim()
    const removedIds = new Set<string>([mid])

    const groupId = String((target as any)?.groupId || '').trim()
    const groupRole = String((target as any)?.groupRole || '').trim()
    let nextMsgs: any[] = []
    if (target.role === 'user' && groupId && groupRole === 'root') {
      const rootMid = String((target as any)?.id || '').trim()
      const next = msgs.filter((m: any) => {
        if (!m || typeof m !== 'object') return true
        const id = String(m?.id || '').trim()
        if (id === mid) return false
        if (String(m?.role || '') !== 'user') return true
        if (String((m as any)?.groupId || '').trim() !== groupId) return true
        if (String((m as any)?.groupRole || '').trim() !== 'attachment') return true
        if (String((m as any)?.groupParentMid || '').trim() !== rootMid) return true
        if (id) removedIds.add(id)
        return false
      })
      nextMsgs = next
    } else {
      nextMsgs = msgs.filter((m: any) => String(m?.id || '').trim() !== mid)
    }

    // 关键：单节点删除要“接上来”——把后续子节点的 parentMid 指向被删节点的 parentMid
    for (const m of nextMsgs) {
      if (!m || typeof m !== 'object') continue
      const pid = String((m as any)?.parentMid || '').trim()
      if (!pid) continue
      if (!removedIds.has(pid)) continue
      ;(m as any).parentMid = targetParentMid
    }

    chat.messages = nextMsgs
    chat.updatedAt = now()
    repairChatLinearBranching(chat)

    if (target.role === 'assistant') {
      try {
        uiStreamCache.delete(mid)
      } catch (_) {}
      try {
        await runtimeStorage.remove(streamKey(mid))
      } catch (_) {}
    }

    // 修复各分支 headMid（避免 head 指向已删除的 mid）
    const branching = ensureChatBranching(chat)
    const newMsgs = Array.isArray(chat.messages) ? (chat.messages as any[]) : []
    const newById = new Map<string, any>()
    for (const m of newMsgs) {
      const id = String(m?.id || '').trim()
      if (!id || newById.has(id)) continue
      newById.set(id, m)
    }
    const lastMid = newMsgs.length ? String((newMsgs[newMsgs.length - 1] as any)?.id || '').trim() : ''
    const branches = Array.isArray((branching as any)?.branches) ? ((branching as any).branches as any[]) : []
    for (const b of branches) {
      const bid = normalizeBranchId((b as any)?.id)
      if (!bid) continue
      const head0 = String((b as any)?.headMid || '').trim()
      if (head0 && newById.has(head0)) continue

      // 1) 沿旧链往上找仍存在的祖先
      let cur = head0
      const seen = new Set<string>()
      let guard = 0
      while (cur && !newById.has(cur) && !seen.has(cur) && guard < 6000) {
        guard++
        seen.add(cur)
        const m = oldById.get(cur) || null
        cur = m ? String((m as any)?.parentMid || '').trim() : ''
      }
      if (cur && newById.has(cur)) {
        ;(b as any).headMid = cur
        continue
      }

      // 2) 找该分支里“最新”的消息作为 head（更符合“接上来”的直觉）
      let pick = ''
      let pickAt = -1
      for (const m of newMsgs) {
        if (!m || typeof m !== 'object') continue
        if (normalizeBranchId((m as any)?.branchId) !== bid) continue
        const t = Number((m as any)?.createdAt || 0)
        if (t > pickAt) {
          pickAt = t
          pick = String((m as any)?.id || '').trim()
        }
      }

      const fallback = targetParentMid && newById.has(targetParentMid) ? targetParentMid : lastMid
      ;(b as any).headMid = pick || fallback || ''
    }

    emit()
    if (!pendingChat) save().catch(() => {})
    api.ui?.showToast?.('已删除')
  }

  async function deleteMessageSubtree(messageId) {
    if (state.loading || !state.data) return
    if (state.sending) return api.ui?.showToast?.('操作中，请稍后重试')

    const mid0 = String(messageId || '').trim()
    if (!mid0) return

    const role = activeRole()
    if (!role) return

    const rid = String(role.id || '')
    const pendingChat = state.pendingChat && String(state.pendingChat.roleId || '') === rid ? state.pendingChat.chat : null
    const chat = pendingChat || activeChatFromData()
    if (!chat) return
    if (chatHasPendingAssistant(chat)) return api.ui?.showToast?.('该会话正在生成中，无法删除消息')

    const msgs = Array.isArray(chat.messages) ? (chat.messages as any[]) : []
    const idx = msgs.findIndex((m) => String(m?.id || '') === mid0)
    if (idx < 0) return api.ui?.showToast?.('未找到该消息')

    const oldById = new Map<string, any>()
    for (const m of msgs) {
      const id = String(m?.id || '').trim()
      if (!id || oldById.has(id)) continue
      oldById.set(id, m)
    }

    const children = new Map<string, string[]>()
    for (const m of msgs) {
      const id = String(m?.id || '').trim()
      if (!id) continue
      const pid = String((m as any)?.parentMid || '').trim()
      if (!pid) continue
      const list = children.get(pid) || []
      list.push(id)
      children.set(pid, list)
    }

    const toDelete = new Set<string>()
    const stack = [mid0]
    while (stack.length) {
      const cur = String(stack.pop() || '').trim()
      if (!cur || toDelete.has(cur)) continue
      toDelete.add(cur)
      const kids = children.get(cur) || []
      for (const k of kids) {
        const id = String(k || '').trim()
        if (id && !toDelete.has(id)) stack.push(id)
      }
    }

    // 附件组：如果删除了某条“附件 root 用户消息”，一并删除其 attachment 子消息（避免遗留孤儿消息）
    const extra = new Set<string>()
    for (const id of toDelete) {
      const m = oldById.get(id) || null
      if (!m || String(m?.role || '') !== 'user') continue
      const groupId = String((m as any)?.groupId || '').trim()
      const groupRole = String((m as any)?.groupRole || '').trim()
      if (!groupId || groupRole !== 'root') continue
      const rootMid = String((m as any)?.id || '').trim()
      for (const x of msgs) {
        if (!x || typeof x !== 'object') continue
        if (String(x?.role || '') !== 'user') continue
        if (String((x as any)?.groupId || '').trim() !== groupId) continue
        if (String((x as any)?.groupRole || '').trim() !== 'attachment') continue
        if (String((x as any)?.groupParentMid || '').trim() !== rootMid) continue
        const xid = String((x as any)?.id || '').trim()
        if (xid) extra.add(xid)
      }
    }
    for (const id of extra) toDelete.add(id)

    const nextMsgs = msgs.filter((m) => {
      const id = String(m?.id || '').trim()
      if (!id) return true
      return !toDelete.has(id)
    })

    if (nextMsgs.length === msgs.length) return api.ui?.showToast?.('未删除任何消息')

    chat.messages = nextMsgs
    chat.updatedAt = now()

    // 清理 assistant 的流式缓存（避免残留）
    for (const id of toDelete) {
      const m = oldById.get(id) || null
      if (!m || String(m?.role || '') !== 'assistant') continue
      try {
        uiStreamCache.delete(id)
      } catch (_) {}
      try {
        await runtimeStorage.remove(streamKey(id))
      } catch (_) {}
    }

    repairChatLinearBranching(chat)

    // 修复各分支 headMid（避免 head 指向已删除消息导致后续切分支“空/坏”）
    const branching = ensureChatBranching(chat)
    const newById = new Map<string, any>()
    for (const m of nextMsgs) {
      const id = String(m?.id || '').trim()
      if (!id || newById.has(id)) continue
      newById.set(id, m)
    }
    const lastMid = nextMsgs.length ? String((nextMsgs[nextMsgs.length - 1] as any)?.id || '').trim() : ''

    const branches = Array.isArray((branching as any)?.branches) ? ((branching as any).branches as any[]) : []
    for (const b of branches) {
      const bid = normalizeBranchId((b as any)?.id)
      if (!bid) continue
      let head = String((b as any)?.headMid || '').trim()
      if (head && newById.has(head)) continue

      // 1) 尝试沿 parentMid 往上找仍存在的祖先
      let cur = head
      const seen = new Set<string>()
      let guard = 0
      while (cur && !newById.has(cur) && !seen.has(cur) && guard < 6000) {
        guard++
        seen.add(cur)
        const m = oldById.get(cur) || null
        cur = m ? String((m as any)?.parentMid || '').trim() : ''
      }
      if (cur && newById.has(cur)) {
        ;(b as any).headMid = cur
        continue
      }

      // 2) 找该分支里“最新”的消息作为 head
      let pick = ''
      let pickAt = -1
      for (const m of nextMsgs) {
        if (!m || typeof m !== 'object') continue
        if (normalizeBranchId((m as any)?.branchId) !== bid) continue
        const t = Number((m as any)?.createdAt || 0)
        if (t > pickAt) {
          pickAt = t
          pick = String((m as any)?.id || '').trim()
        }
      }
      ;(b as any).headMid = pick || lastMid
    }

    emit()
    if (!pendingChat) save().catch(() => {})
    api.ui?.showToast?.('已删除（含子节点）')
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
    repairChatLinearBranching(chat)

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
    const kind = String((job as any).targetKind || '').trim() === 'group' || !!(job as any).groupId ? 'group' : 'role'
    const roleId = String(job?.roleId || '')
    const groupId = String((job as any)?.groupId || '')
    const chatId = String(job?.chatId || '')
    const mid = String(job?.assistantMid || '')
    if (!roleId || !chatId || !mid || (kind === 'group' && !groupId)) return

    const meta = await loadSplitMeta()
    if (!meta) return

    const folder = kind === 'group' ? String((meta as any).groupFolders?.[groupId] || '') : String(meta.roleFolders?.[roleId] || '')
    if (!folder) return
    const key = kind === 'group' ? splitGroupChatKey(folder, chatId) : splitChatKey(folder, chatId)
    const raw = await api.storage.get(key)
    const chat = raw && typeof raw === 'object' ? raw : null
    if (!chat) return

    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const m = msgs.find((x) => String(x?.id) === mid)
    if (!m) return

    // 永不破坏用户空间：如果该消息已不在 pending 状态（例如用户点了“停止”并已落盘），
    // 后台 job 不应再覆写它（避免“已停止”后又被旧请求写回）。
    if (m.pending !== true) return

    m.content = String(content || '')
    m.pending = false
    m.streaming = false
    chat.updatedAt = now()
    repairChatLinearBranching(chat)

    await api.storage.set(key, chat)

    try {
      if (kind === 'group') await touchGroupChatUpdatedAt(groupId, chatId, chat.updatedAt)
      else await touchChatUpdatedAt(roleId, chatId, chat.updatedAt)
    } catch (_) {}

    await writeChatUpdatedNotice(kind, kind === 'group' ? groupId : roleId, chatId, chat.updatedAt)
  }

  async function insertMessagesAfterMessageId(job, afterMid, items) {
    const kind = String((job as any).targetKind || '').trim() === 'group' || !!(job as any).groupId ? 'group' : 'role'
    const roleId = String(job?.roleId || '')
    const groupId = String((job as any)?.groupId || '')
    const chatId = String(job?.chatId || '')
    const mid = String(afterMid || '').trim()
    if (!roleId || !chatId || !mid || (kind === 'group' && !groupId)) return { ok: false as const, insertedAssistant: false as const }

    const list = Array.isArray(items) ? items.filter((x) => x && typeof x === 'object') : []
    if (!list.length) return { ok: false as const, insertedAssistant: false as const }

    const meta = await loadSplitMeta()
    if (!meta) return { ok: false as const, insertedAssistant: false as const }

    const folder = kind === 'group' ? String((meta as any).groupFolders?.[groupId] || '') : String(meta.roleFolders?.[roleId] || '')
    if (!folder) return { ok: false as const, insertedAssistant: false as const }
    const key = kind === 'group' ? splitGroupChatKey(folder, chatId) : splitChatKey(folder, chatId)
    const raw = await api.storage.get(key)
    const chat = raw && typeof raw === 'object' ? raw : null
    if (!chat) return { ok: false as const, insertedAssistant: false as const }

    const msgs = Array.isArray(chat.messages) ? chat.messages : []
    const idx = msgs.findIndex((x) => String(x?.id || '') === mid)
    if (idx < 0) return { ok: false as const, insertedAssistant: false as const }

    // Avoid starting a second pending assistant in the same chat.
    const hasPendingAssistant = msgs.some((m) => m && m.role === 'assistant' && !!m.pending)
    const toInsert = hasPendingAssistant ? list.filter((m) => String(m?.role || '') !== 'assistant') : list
    if (!toInsert.length) return { ok: false as const, insertedAssistant: false as const }

    const afterMsg = msgs[idx] && typeof msgs[idx] === 'object' ? msgs[idx] : null
    const desiredBranchId = normalizeBranchId((afterMsg as any)?.branchId || (job as any)?.branchId || CHAT_DEFAULT_BRANCH_ID)
    let parentMid = mid
    for (const m of toInsert) {
      if (!m || typeof m !== 'object') continue
      if (!String((m as any).id || '').trim()) (m as any).id = uid('m')
      if (!String((m as any).branchId || '').trim()) (m as any).branchId = desiredBranchId
      if (!String((m as any).parentMid || '').trim()) (m as any).parentMid = parentMid
      parentMid = String((m as any).id || '').trim()
    }

    const next = msgs.slice()
    next.splice(idx + 1, 0, ...toInsert)
    chat.messages = next
    chat.updatedAt = now()
    repairChatLinearBranching(chat)

    await api.storage.set(key, chat)

    try {
      if (kind === 'group') await touchGroupChatUpdatedAt(groupId, chatId, chat.updatedAt)
      else await touchChatUpdatedAt(roleId, chatId, chat.updatedAt)
    } catch (_) {}

    await writeChatUpdatedNotice(kind, kind === 'group' ? groupId : roleId, chatId, chat.updatedAt)

    return { ok: true as const, insertedAssistant: !hasPendingAssistant && toInsert.some((m) => String(m?.role || '') === 'assistant') }
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

          const j = await runtimeStorage.get(jobKey(jobId))
          const job = j && typeof j === 'object' ? j : null
          if (!job) {
            await dequeueJob(jobId)
            continue
          }
          if (String(job.status || '') !== 'queued') {
            await dequeueJob(jobId)
            continue
          }

          const kind = String((job as any).targetKind || '').trim() === 'group' || !!(job as any).groupId ? 'group' : 'role'
          const roleId = String(job.roleId || '')
          const chatId = String(job.chatId || '')
          const groupId = String((job as any).groupId || '')
          if (!roleId || !chatId || (kind === 'group' && !groupId)) {
            await dequeueJob(jobId)
            continue
          }
          const chatKey = kind === 'group' ? `g:${groupId}/${chatId}` : `r:${roleId}/${chatId}`
          if (runningChatKeys.has(chatKey)) continue
          runningChatKeys.add(chatKey)

          job.status = 'running'
          job.startedAt = now()
          await runtimeStorage.set(jobKey(job.id), job)

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
        // fallback：找最后一个 user（避免 parentMid 缺失导致上下文为空）
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
        const idx = msgs0.findIndex((m) => String(m?.id || '') === cutoffMid)
        if (idx >= 0) baseMsgs0 = msgs0.slice(0, idx)
      }
      historySource = baseMsgs0.filter((m) => !(m && m.role === 'assistant' && m.pending))
    }

    const history = limitHistory(historySource, 40)

    const sys = String(role.systemPrompt || '').trim()
    const messages = []
    if (sys) messages.push({ role: 'system', content: sys })

    for (const m of history) {
      const r = m?.role === 'assistant' ? 'assistant' : 'user'
      const text = r === 'user' ? buildUserTextForOpenAi(m) : String(m?.content || '')
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

    const r0 = await api.storage.get(splitRoleKey(roleFolder))
    const role = r0 && typeof r0 === 'object' ? r0 : null
    if (!role) throw new Error('角色不存在')

    const g0 = await api.storage.get(splitGroupKey(groupFolder))
    const group = g0 && typeof g0 === 'object' ? g0 : null
    if (!group) throw new Error('群组不存在')

    const d = normalizeData({
      version: VERSION,
      settings: meta.settings && typeof meta.settings === 'object' ? meta.settings : {},
      roles: [role],
      chatsByRole: {},
      groups: [group],
      chatsByGroup: {},
      ui: meta.ui && typeof meta.ui === 'object' ? meta.ui : {},
    } as any)

    const c0 = await api.storage.get(splitGroupChatKey(groupFolder, chatId))
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
        const rr0 = await api.storage.get(splitRoleKey(folder))
        const rr = rr0 && typeof rr0 === 'object' ? rr0 : null
        if (!rr) continue
        roleNameById.set(rid, String((rr as any).name || '').trim() || 'AI')
      } catch (_) {}
    }
    if (!roleNameById.has(roleId)) roleNameById.set(roleId, String((role as any).name || '').trim() || 'AI')

    const speakerName = roleNameById.get(roleId) || 'AI'

    const messages: any[] = []
    if (sys) messages.push({ role: 'system', content: sys })
    if (groupPrompt) messages.push({ role: 'system', content: `群聊设定：\n${groupPrompt}` })

    for (const m of history) {
      const r = m?.role === 'assistant' ? 'assistant' : 'user'
      if (r === 'user') {
        const baseText = buildUserTextForOpenAi(m)
        const wrappedText = `[${GROUP_SPEAKER_USER_PREFIX}的发言]: ${baseText}`.trimEnd()
        const paths = normImagePaths(m?.images)
        if (paths.length) {
          if (typeof api?.files?.images?.read !== 'function') throw new Error('未授权：files.images.read')
          const parts: any[] = [{ type: 'text', text: wrappedText }]
          for (const path of paths) {
            let dataUrl = ''
            try {
              dataUrl = await api.files.images.read({ scope: 'data', path })
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

    // 最后一条：模拟用户提示（仅用于本次上下文拼装，不写入 history）
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

    // background runtime does not call load(), so we must read toolCallServer config from storage.
    const d = normalizeData({
      version: VERSION,
      settings: meta.settings && typeof meta.settings === 'object' ? meta.settings : {},
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

  async function runBackgroundJob(job) {
    const streamWanted = !!job?.stream
    let req = job?.req || null
    const mid = String(job?.assistantMid || '')
    if (!req || typeof req !== 'object') {
      if (String(job?.kind || '') === 'openai.chat.completions') {
        const kind = String((job as any).targetKind || '').trim() === 'group' || !!(job as any).groupId ? 'group' : 'role'
        req = kind === 'group' ? await buildOpenAiGroupChatReqFromStorage(job) : await buildOpenAiChatReqFromStorage(job)
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
    let toolRequestCompleted = false
    const toolTruncator = createToolRequestStreamTruncator('')

    const checkCanceled = async (force) => {
      if (canceled) return true
      const t = now()
      if (!force && t - lastCancelCheck < 250) return false
      lastCancelCheck = t
      try {
        const v1 = await runtimeStorage.get(cancelKey(job.id))
        const v2 = mid ? await runtimeStorage.get(cancelMidKey(mid)) : null
        if (v1) canceled = true
        if (!canceled && v2) {
          const requestedAt = Number((v2 as any)?.requestedAt || 0)
          const createdAt = Number(job?.createdAt || 0)
          // cancelMidKey(mid) 语义：取消“在 requestedAt 之前创建”的那一轮生成。
          // regenerate 会复用同一个 mid，但 job.createdAt 会更新；因此需做时间判定，避免新 job 被旧 cancel 误杀。
          if (requestedAt > 0 && createdAt > 0) canceled = requestedAt >= createdAt
          else canceled = true
        }
      } catch (_) {}
      return canceled
    }

    const flush = async (force) => {
      if (!mid) return
      const t = now()
      if (!force && t - lastFlush < 220) return
      lastFlush = t
      await runtimeStorage.set(streamKey(mid), { text: out, updatedAt: t })
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
              if (typeof delta === 'string' && delta) {
                const r = toolTruncator.appendDelta(delta)
                out = r.text
                toolRequestCompleted = r.toolRequestCompleted
              }
            })

            // If we just completed a TOOL_REQUEST block, force-flush immediately.
            // Otherwise the final marker can get stuck behind the flush throttle while we execute tools.
            if (toolRequestCompleted) await flush(true)
            else await flush(false)
            if (toolRequestCompleted || sse.done) break
            continue
          }
          if (t === 'error') throw new Error(String(ev?.message || '请求失败'))
          if (t === 'end') break
        }

        if (canceled) {
          try {
            await (stream as any)?.cancel?.()
          } catch (_) {}
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
            if (typeof delta === 'string' && delta) {
              const r2 = toolTruncator.appendDelta(delta)
              out = r2.text
              toolRequestCompleted = r2.toolRequestCompleted
            }
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

        if (toolRequestCompleted) {
          // 本轮 AI 回复在 TOOL_REQUEST 块闭合时就应结束；不要等待工具执行。
          await flush(true)
          await patchAssistantMessage(job, out)

          // Fire-and-forget: execute tools, inject TOOL_RESPONSE (role:user), then enqueue next AI round.
          ;(async () => {
            const buildFailureResults = (calls, msg, status) => {
              const items = Array.isArray(calls) ? calls : []
              const error = String(msg || 'tool call failed')
              const s = String(status || 'failed') || 'failed'
              if (!items.length) return [{ tool_name: '', status: s, error }]
              return items.map((c) => ({ tool_name: String(c?.tool_name || ''), status: s, error }))
            }

            const roleId = String(job?.roleId || '')
            const chatId = String(job?.chatId || '')
            const anchorMid = String(job?.assistantMid || '')

            const assistantMid2 = uid('m')
            const jobId2 = uid('job')
            const assistantMid2CreatedAt = now()

            const isCanceledByMid = async (mid, createdAt) => {
              const m = String(mid || '').trim()
              if (!m) return false
              try {
                const v = await runtimeStorage.get(cancelMidKey(m))
                if (!v) return false
                const requestedAt = Number((v as any)?.requestedAt || 0)
                const ca = Number(createdAt || 0)
                if (requestedAt > 0 && ca > 0) return requestedAt >= ca
                return true
              } catch (_) {
                return false
              }
            }

            const markAssistantFailed = async (msg) => {
              const text = String(msg || '').trim() || '（工具调用失败）'
              try {
                await patchAssistantMessage({ roleId, chatId, assistantMid: assistantMid2 }, text)
              } catch (_) {}
            }

            let streamEnabled = !!job?.stream
            let calls = []
            let results = []

            const insertedAssistant = await insertMessagesAfterMessageId(job, anchorMid, [
              {
                id: assistantMid2,
                role: 'assistant',
                content: '（生成中…）',
                pending: true,
                streaming: !!streamEnabled,
                createdAt: assistantMid2CreatedAt,
              },
            ])

            if (!insertedAssistant.ok || !insertedAssistant.insertedAssistant) return
            if (await isCanceledByMid(assistantMid2, assistantMid2CreatedAt)) return

            try {
              const parsed = parseToolRequestCalls(out)
              calls = mapParsedCallsToServerCalls(parsed.calls)

              let baseUrl = ''
              let token = ''
              try {
                const cfg = await loadToolCallServerConfigFromStorage()
                baseUrl = cfg.baseUrl
                token = cfg.token
                streamEnabled = !!cfg.streamEnabled
              } catch (e) {
                results = buildFailureResults(calls, `读取工具服务配置失败：${String(e?.message || e || 'unknown')}`, 'failed')
              }

              if (!results.length) {
                if (!parsed.ok) {
                  results = buildFailureResults(calls, `解析 TOOL_REQUEST 失败：${String(parsed.error || 'unknown')}`, 'failed')
                } else if (!baseUrl || !isHttpBaseUrl(baseUrl)) {
                  results = buildFailureResults(calls, '工具服务未配置或 Base URL 无效（需 http/https）', 'failed')
                } else {
                  if (await isCanceledByMid(assistantMid2, assistantMid2CreatedAt)) return
                  try {
                    const resp = await executeToolCallsOnServer({
                      request: (x) => api.net.request(x as any) as any,
                      server: { baseUrl, token },
                      body: { timeout_ms: 30000, calls },
                    })
                    const box = (resp as any)?.json
                    results = Array.isArray(box?.results) ? box.results : []
                  } catch (e) {
                    const msg = String(e?.message || e || 'tool server request failed')
                    results = buildFailureResults(calls, msg, 'failed')
                  }
                }
              }
            } catch (e) {
              results = buildFailureResults(calls, `工具链异常：${String(e?.message || e || 'unknown')}`, 'failed')
            }

            if (!Array.isArray(results) || !results.length) {
              results = buildFailureResults(calls, '工具调用失败（未知原因）', 'failed')
            }

            if (await isCanceledByMid(assistantMid2, assistantMid2CreatedAt)) return

            const toolResponseText = formatToolResponseBlock(results as any)
            const toolMid = uid('m')

            const insertedTool = await insertMessagesAfterMessageId(job, anchorMid, [
              { id: toolMid, role: 'user', content: toolResponseText, createdAt: now() },
            ])

            if (!insertedTool.ok) {
              await markAssistantFailed('（工具调用失败：写入 TOOL_RESPONSE 失败）')
              return
            }

            if (await isCanceledByMid(assistantMid2, assistantMid2CreatedAt)) return

            const job2 = {
              id: jobId2,
              kind: 'openai.chat.completions',
              status: 'queued',
              createdAt: assistantMid2CreatedAt,
              roleId,
              chatId,
              assistantMid: assistantMid2,
              cutoffMid: assistantMid2,
              stream: !!streamEnabled,
            }

            try {
              await runtimeStorage.set(jobKey(jobId2), job2)
              if (await isCanceledByMid(assistantMid2, assistantMid2CreatedAt)) return
              await enqueueJob(jobId2)
            } catch (_) {
              await markAssistantFailed('（工具调用失败：排队下一轮失败）')
              return
            }
          })().catch(() => {})

          return
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
          await runtimeStorage.remove(streamKey(mid))
        } catch (_) {}
      }
      try {
        await runtimeStorage.remove(jobKey(job.id))
      } catch (_) {}
      try {
        await runtimeStorage.remove(cancelKey(job.id))
      } catch (_) {}
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
      const scale = clamp(state.mermaid.scale, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
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
  let uiLastMetaCheckMs = 0
  let uiLastMetaUpdatedAt = 0
  const uiStreamCache = new Map()
  let uiChatSyncing = false
  let uiLastChatUpdatedNoticeId = ''

  async function syncActiveRoleChatsFromStorage(metaOverride?: any) {
    if (!state.data) return
    if (uiChatSyncing) return
    uiChatSyncing = true
    try {
      const rid = String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '')
      if (!rid) return

      const meta = metaOverride || (await loadSplitMeta())
      if (!meta || typeof meta !== 'object') return

      const updatedAt = Number((meta as any).updatedAt || 0)
      if (updatedAt) uiLastMetaUpdatedAt = Math.max(uiLastMetaUpdatedAt, updatedAt)

      const folder = String((meta as any).roleFolders?.[rid] || '')
      const idx = (meta as any).chatIndexByRole?.[rid]
      if (!folder || !idx || typeof idx !== 'object') return

      const desiredChatIds = Array.isArray((idx as any).chatIds) ? (idx as any).chatIds.map((x) => String(x || '')).filter((x) => !!x) : []
      const desiredActiveChatId = String((idx as any).activeChatId || '')
      const wantUpdatedAt = (idx as any).chatUpdatedAt && typeof (idx as any).chatUpdatedAt === 'object' ? (idx as any).chatUpdatedAt : {}

      if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
      if (!state.data.chatsByRole[rid] || typeof state.data.chatsByRole[rid] !== 'object') state.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
      const box = state.data.chatsByRole[rid]
      if (!Array.isArray(box.chats)) box.chats = []

      const keepChatNow = String(box.activeChatId || '')
      const activeChatId = keepChatNow || desiredActiveChatId || String(desiredChatIds[0] || '')

      const curChats = box.chats
      const curById = new Map<string, any>()
      for (const c of curChats) {
        const cid = String(c?.id || '')
        if (cid) curById.set(cid, c)
      }

      const nextChats: any[] = []
      for (const cid of desiredChatIds) {
        const cur = curById.get(cid) || null
        if (!cur) {
          // 新会话出现在索引里：只在必要时读取一次文件，不做全量刷新。
          const c0 = await api.storage.get(splitChatKey(folder, cid))
          const c1 = c0 && typeof c0 === 'object' ? c0 : null
          if (c1) nextChats.push(c1)
          continue
        }

        // 非当前会话：只同步 updatedAt（用于列表排序/时间显示），避免把轮询扩散成“全量 chat 刷新”。
        const metaUpdatedAt = Number((wantUpdatedAt as any)?.[cid] || 0)
        if (metaUpdatedAt && cid !== activeChatId) cur.updatedAt = metaUpdatedAt
        nextChats.push(cur)
      }

      // 当前会话：如果索引里 updatedAt 变了，就只读取这一份 chat 文件刷新消息内容。
      if (activeChatId) {
        const metaUpdatedAt = Number((wantUpdatedAt as any)?.[activeChatId] || 0)
        const cur = curById.get(activeChatId) || null
        const curUpdatedAt = Number(cur?.updatedAt || 0)
        if (metaUpdatedAt && metaUpdatedAt !== curUpdatedAt) {
          const c0 = await api.storage.get(splitChatKey(folder, activeChatId))
          const c1 = c0 && typeof c0 === 'object' ? c0 : null
          if (c1) {
            const idx0 = nextChats.findIndex((c) => String(c?.id || '') === activeChatId)
            if (idx0 >= 0) nextChats[idx0] = c1
            else nextChats.unshift(c1)
          }
        }
      }

      box.chats = nextChats

      if (keepChatNow && nextChats.some((c) => String(c?.id || '') === keepChatNow)) box.activeChatId = keepChatNow
      else if (desiredActiveChatId && nextChats.some((c) => String(c?.id || '') === desiredActiveChatId)) box.activeChatId = desiredActiveChatId
      else box.activeChatId = String(nextChats[0]?.id || '')
    } finally {
      uiChatSyncing = false
    }
  }

  async function syncActiveGroupChatsFromStorage(metaOverride?: any) {
    if (!state.data) return
    if (uiChatSyncing) return
    uiChatSyncing = true
    try {
      const gid = String((state.draft as any).activeGroupId || (state.data?.ui as any)?.activeGroupId || '').trim()
      if (!gid) return

      const meta = metaOverride || (await loadSplitMeta())
      if (!meta || typeof meta !== 'object') return

      const updatedAt = Number((meta as any).updatedAt || 0)
      if (updatedAt) uiLastMetaUpdatedAt = Math.max(uiLastMetaUpdatedAt, updatedAt)

      const folder = String((meta as any).groupFolders?.[gid] || '')
      const idx = (meta as any).chatIndexByGroup?.[gid]
      if (!folder || !idx || typeof idx !== 'object') return

      const desiredChatIds = Array.isArray((idx as any).chatIds) ? (idx as any).chatIds.map((x: any) => String(x || '')).filter((x: any) => !!x) : []
      const desiredActiveChatId = String((idx as any).activeChatId || '')
      const wantUpdatedAt = (idx as any).chatUpdatedAt && typeof (idx as any).chatUpdatedAt === 'object' ? (idx as any).chatUpdatedAt : {}

      if (!(state.data as any).chatsByGroup || typeof (state.data as any).chatsByGroup !== 'object') (state.data as any).chatsByGroup = {}
      if (!(state.data as any).chatsByGroup[gid] || typeof (state.data as any).chatsByGroup[gid] !== 'object') (state.data as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
      const box = (state.data as any).chatsByGroup[gid]
      if (!Array.isArray(box.chats)) box.chats = []

      const keepChatNow = String(box.activeChatId || '')
      const activeChatId = keepChatNow || desiredActiveChatId || String(desiredChatIds[0] || '')

      const curChats = box.chats
      const curById = new Map<string, any>()
      for (const c of curChats) {
        const cid = String(c?.id || '')
        if (cid) curById.set(cid, c)
      }

      const nextChats: any[] = []
      for (const cid of desiredChatIds) {
        const cur = curById.get(cid) || null
        if (!cur) {
          const c0 = await api.storage.get(splitGroupChatKey(folder, cid))
          const c1 = c0 && typeof c0 === 'object' ? c0 : null
          if (c1) nextChats.push(c1)
          continue
        }

        const metaUpdatedAt = Number((wantUpdatedAt as any)?.[cid] || 0)
        if (metaUpdatedAt && cid !== activeChatId) cur.updatedAt = metaUpdatedAt
        nextChats.push(cur)
      }

      for (const c of curChats) {
        const cid = String(c?.id || '')
        if (!cid) continue
        if (!desiredChatIds.includes(cid)) continue
        if (cid !== activeChatId) continue

        const cur = curById.get(cid) || null
        if (!cur) continue
        const want = Number((wantUpdatedAt as any)?.[cid] || 0)
        if (!want || Number(cur.updatedAt || 0) === want) continue
        const c0 = await api.storage.get(splitGroupChatKey(folder, cid))
        const c1 = c0 && typeof c0 === 'object' ? c0 : null
        if (c1) {
          const idx0 = nextChats.findIndex((x) => String(x?.id || '') === activeChatId)
          if (idx0 >= 0) nextChats[idx0] = c1
          else nextChats.unshift(c1)
        }
      }

      box.chats = nextChats

      if (keepChatNow && nextChats.some((c: any) => String(c?.id || '') === keepChatNow)) box.activeChatId = keepChatNow
      else if (desiredActiveChatId && nextChats.some((c: any) => String(c?.id || '') === desiredActiveChatId)) box.activeChatId = desiredActiveChatId
      else box.activeChatId = String(nextChats[0]?.id || '')
    } finally {
      uiChatSyncing = false
    }
  }

  async function syncActiveTargetChatsFromStorage(metaOverride?: any) {
    if (activeTargetKind() === 'group') return syncActiveGroupChatsFromStorage(metaOverride)
    return syncActiveRoleChatsFromStorage(metaOverride)
  }

  async function syncChatByIdFromStorage(roleId, chatId) {
    if (!state.data) return false
    const rid = String(roleId || '').trim()
    const cid = String(chatId || '').trim()
    if (!rid || !cid) return false

    const meta = (await loadSplitMeta()) || splitMetaCache
    if (!meta) return false
    const folder = String(meta.roleFolders?.[rid] || '')
    if (!folder) return false

    const raw = await api.storage.get(splitChatKey(folder, cid))
    const chat = raw && typeof raw === 'object' ? raw : null
    if (!chat) return false

    if (!state.data.chatsByRole || typeof state.data.chatsByRole !== 'object') state.data.chatsByRole = {}
    if (!state.data.chatsByRole[rid] || typeof state.data.chatsByRole[rid] !== 'object') state.data.chatsByRole[rid] = { activeChatId: '', chats: [] }
    const box = state.data.chatsByRole[rid]
    if (!Array.isArray(box.chats)) box.chats = []

    const idx = box.chats.findIndex((c) => String(c?.id || '') === cid)
    if (idx >= 0) box.chats[idx] = chat
    else box.chats.unshift(chat)

    return true
  }

  async function syncGroupChatByIdFromStorage(groupId: any, chatId: any) {
    if (!state.data) return false
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) return false

    const meta = (await loadSplitMeta()) || splitMetaCache
    if (!meta) return false
    const folder = String((meta as any).groupFolders?.[gid] || '')
    if (!folder) return false

    const raw = await api.storage.get(splitGroupChatKey(folder, cid))
    const chat = raw && typeof raw === 'object' ? raw : null
    if (!chat) return false

    if (!(state.data as any).chatsByGroup || typeof (state.data as any).chatsByGroup !== 'object') (state.data as any).chatsByGroup = {}
    if (!(state.data as any).chatsByGroup[gid] || typeof (state.data as any).chatsByGroup[gid] !== 'object') (state.data as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
    const box = (state.data as any).chatsByGroup[gid]
    if (!Array.isArray(box.chats)) box.chats = []

    const idx = box.chats.findIndex((c: any) => String(c?.id || '') === cid)
    if (idx >= 0) box.chats[idx] = chat
    else box.chats.unshift(chat)

    return true
  }

  async function applyChatUpdatedNoticeOnce() {
    if (state.loading || !state.data) return false
    let raw = null
    try {
      raw = await runtimeStorage.get(UI_CHAT_UPDATED_NOTICE_KEY)
    } catch (_) {
      raw = null
    }
    if (!raw || typeof raw !== 'object') return false

    const nid = String((raw as any).id || '')
    if (!nid || nid === uiLastChatUpdatedNoticeId) return false
    uiLastChatUpdatedNoticeId = nid

    const kind = String((raw as any).targetKind || '').trim() === 'group' ? 'group' : 'role'
    const tid = String((raw as any).targetId || (raw as any).roleId || '').trim()
    const cid = String((raw as any).chatId || '').trim()
    const updatedAt = Number((raw as any).updatedAt || 0)
    if (!tid || !cid) return false

    const activeKind = activeTargetKind()
    const activeTid =
      activeKind === 'group'
        ? String((state.draft as any).activeGroupId || (state.data?.ui as any)?.activeGroupId || '').trim()
        : String(state.draft.activeRoleId || state.data?.ui?.activeRoleId || '').trim()
    if (!activeTid || kind !== activeKind || tid !== activeTid) return false

    const activeChatId = String(activeChatFromData()?.id || '').trim()
    if (activeChatId && cid === activeChatId) {
      const ok = kind === 'group' ? await syncGroupChatByIdFromStorage(tid, cid) : await syncChatByIdFromStorage(tid, cid)
      return !!ok
    }

    // 非当前会话：并发生成时也要尽快把“生成中…”替换为落盘内容，否则列表会一直显示 pending。
    try {
      const ok = kind === 'group' ? await syncGroupChatByIdFromStorage(tid, cid) : await syncChatByIdFromStorage(tid, cid)
      if (ok) return true
    } catch (_) {}

    // 兜底：如果读取失败，至少更新时间戳（如果该会话在内存里）。
    const box = kind === 'group' ? (state.data as any)?.chatsByGroup?.[tid] : state.data?.chatsByRole?.[tid]
    const chats = Array.isArray(box?.chats) ? box.chats : []
    const it = chats.find((c) => String(c?.id || '') === cid) || null
    if (it && updatedAt && Number(it.updatedAt || 0) !== updatedAt) {
      it.updatedAt = updatedAt
      return true
    }

    return false
  }

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

  function findGroupChatByIds(groupId: any, chatId: any) {
    if (!state.data) return null
    const gid = String(groupId || '')
    const cid = String(chatId || '')
    if (!gid || !cid) return null
    const box = (state.data as any).chatsByGroup?.[gid]
    const chats = Array.isArray((box as any)?.chats) ? (box as any).chats : []
    return chats.find((c: any) => String(c?.id || '') === cid) || null
  }

  function startUiPollers() {
    if (uiPollTimer) return
    uiPollTimer = window.setInterval(() => {
      uiPollTick().catch(() => {})
    }, 350)
  }

  async function uiPollTick() {
    if (state.loading || !state.data) return

    let chat = activeChatFromData()
    if (!chat) return

    try {
      const changedByNotice = await applyChatUpdatedNoticeOnce()
      if (changedByNotice) {
        chat = activeChatFromData()
        reapplyUiStreamCache(chat)
        emit()
      }
    } catch (_) {}

    const items = Array.isArray(chat.messages) ? chat.messages : []
    const pending = items.filter((m) => m && m.role === 'assistant' && m.pending).slice(-3)

    if (pending.length) {
      let changed = false
      for (const m of pending) {
        if (!m.streaming) continue
        const s = await runtimeStorage.get(streamKey(String(m.id || '')))
        const text = String(s?.text || '')
        if (!text) continue
        const mid = String(m.id || '')
        if (uiStreamCache.get(mid) === text) continue
        uiStreamCache.set(mid, text)
        m.content = text
        changed = true
      }
      if (changed) emit()

      // 有 pending assistant 时，工具调用/后台写入的落盘也更频繁；此时把 meta 检查频率提到 tick 级别。
      const t = now()
      if (t - uiLastMetaCheckMs > 350) {
        uiLastMetaCheckMs = t
        if (state.sending || state.pendingChat || (state as any).pendingGroupChat) return
        try {
          const meta = await loadSplitMeta()
          const updatedAt = Number(meta?.updatedAt || 0)
          if (updatedAt && updatedAt !== uiLastMetaUpdatedAt) {
            await syncActiveTargetChatsFromStorage(meta)
            chat = activeChatFromData()
            reapplyUiStreamCache(chat)
            emit()
          }
        } catch (_) {}
      }

      return
    }

    uiStreamCache.clear()

    // No pending assistant: still poll meta/index.updatedAt and sync when background wrote new messages
    // (e.g. TOOL_RESPONSE injection + next assistant job), otherwise UI would only update after manual refresh.
    const t2 = now()
    if (t2 - uiLastMetaCheckMs > 900) {
      uiLastMetaCheckMs = t2
      if (!state.sending && !state.pendingChat && !(state as any).pendingGroupChat) {
        try {
          const meta = await loadSplitMeta()
          const updatedAt = Number(meta?.updatedAt || 0)
          if (updatedAt && updatedAt !== uiLastMetaUpdatedAt) {
            await syncActiveTargetChatsFromStorage(meta)
            chat = activeChatFromData()
            reapplyUiStreamCache(chat)
            emit()
          }
        } catch (_) {}
      }
    }

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

  async function pickGroupAvatarImage() {
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

      ;(state.draft as any).groupAvatarImageCropSrc = u
      render()
    } catch (e) {
      api.ui?.showToast?.(String((e as any)?.message || e || '选择头像失败'))
    }
  }

  function clearGroupAvatarImage() {
    ;(state.draft as any).groupAvatarImage = ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    render()
  }

  function closeModal() {
    cancelMermaidDrag()
    state.modal = ''
    state.draft.deleteRoleId = ''
    ;(state.draft as any).deleteGroupId = ''
    state.draft.deleteProviderId = ''
    state.draft.roleAvatarImageCropSrc = ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
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
    if (String((state.draft as any).editGroupId || '') === NEW_GROUP_ID) {
      ;(state.draft as any).editGroupId = ''
      ;(state.draft as any).groupName = ''
      ;(state.draft as any).groupAvatar = ''
      ;(state.draft as any).groupAvatarImage = ''
      ;(state.draft as any).groupAvatarImageCropSrc = ''
      ;(state.draft as any).groupPrompt = ''
      ;(state.draft as any).groupMode = 'roundRobin'
      ;(state.draft as any).groupMemberRoleIds = []
      ;(state.draft as any).groupRoundRobinOrder = []
      ;(state.draft as any).groupRandomWeights = {}
      ;(state.draft as any).groupRandomMinCount = 1
      ;(state.draft as any).groupRandomMaxCount = 2
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
      const t = now()
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
        chats: [{ id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }],
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
      ;(state.data as any).groups = (d as any).groups
      ;(state.data as any).chatsByGroup = (d as any).chatsByGroup
      state.data.ui = d.ui
    }

    state.draft.activeRoleId = String(state.data.roles[0]?.id || '')
    if (!Array.isArray((state.data as any).groups) || !(state.data as any).groups.length) {
      ;(state.draft as any).activeTargetKind = 'role'
      ;(state.draft as any).activeGroupId = ''
    }
    save().catch(() => {})
  }

  function ensureGroupsList() {
    if (!state.data) return
    if (!Array.isArray((state.data as any).groups)) (state.data as any).groups = []
    if (!(state.data as any).chatsByGroup || typeof (state.data as any).chatsByGroup !== 'object') (state.data as any).chatsByGroup = {}
  }

  function ensureGroupChatsBoxBare(groupId: any) {
    if (!state.data) return null
    ensureGroupsList()
    const gid = String(groupId || '').trim()
    if (!gid) return null
    if (!(state.data as any).chatsByGroup[gid] || typeof (state.data as any).chatsByGroup[gid] !== 'object') (state.data as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
    const box = (state.data as any).chatsByGroup[gid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.activeChatId = String(box.activeChatId || '')
    if (box.activeChatId && !box.chats.some((c: any) => String(c?.id || '') === box.activeChatId)) box.activeChatId = ''
    if (!box.activeChatId && box.chats.length) box.activeChatId = String(box.chats[0]?.id || '')
    return box
  }

  function ensureGroupChatsBox(groupId: any) {
    if (!state.data) return null
    ensureGroupsList()
    const gid = String(groupId || '').trim()
    if (!gid) return null
    if (!(state.data as any).chatsByGroup[gid] || typeof (state.data as any).chatsByGroup[gid] !== 'object') (state.data as any).chatsByGroup[gid] = { activeChatId: '', chats: [] }
    const box = (state.data as any).chatsByGroup[gid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.activeChatId = String(box.activeChatId || '')
    if (!box.chats.length) {
      const cid = uid('gc')
      const t = now()
      box.chats = [{ id: cid, title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
      box.activeChatId = cid
    }
    if (!box.activeChatId || !box.chats.some((c: any) => String(c?.id) === box.activeChatId)) box.activeChatId = String(box.chats[0]?.id || '')
    return box
  }

  function openNewGroupEditor() {
    if (!state.data) return
    ensureGroupsList()

    ;(state.draft as any).editGroupId = NEW_GROUP_ID
    ;(state.draft as any).groupName = '新群组'
    ;(state.draft as any).groupAvatar = '👥'
    ;(state.draft as any).groupAvatarImage = ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    ;(state.draft as any).groupPrompt = ''
    ;(state.draft as any).groupMode = 'roundRobin'
    ;(state.draft as any).groupMemberRoleIds = []
    ;(state.draft as any).groupRoundRobinOrder = []
    ;(state.draft as any).groupRandomWeights = {}
    ;(state.draft as any).groupRandomMinCount = 1
    ;(state.draft as any).groupRandomMaxCount = 2

    state.modal = 'group'
    render()
  }

  function createGroup() {
    openNewGroupEditor()
  }

  function openGroupEditor(groupId: any) {
    if (!state.data) return
    ensureGroupsList()

    const gid = String(groupId || '').trim()
    if (!gid) return
    const group = ((state.data as any).groups as any[]).find((g: any) => String(g?.id || '') === gid) || null
    if (!group) return

    ;(state.draft as any).editGroupId = gid
    ;(state.draft as any).groupName = String(group?.name || '')
    ;(state.draft as any).groupAvatar = String(group?.avatar || '')
    ;(state.draft as any).groupAvatarImage = looksLikeImageDataUrl(group?.avatarImage) ? String(group?.avatarImage || '') : ''
    ;(state.draft as any).groupAvatarImageCropSrc = ''
    ;(state.draft as any).groupPrompt = String(group?.prompt || '')
    ;(state.draft as any).groupMode = String(group?.mode || 'roundRobin') === 'random' ? 'random' : 'roundRobin'
    ;(state.draft as any).groupMemberRoleIds = Array.isArray(group?.memberRoleIds) ? group.memberRoleIds.slice(0, 50) : []
    ;(state.draft as any).groupRoundRobinOrder = Array.isArray(group?.roundRobinOrder) ? group.roundRobinOrder.slice(0, 80) : []

    const randomCfg = group?.random && typeof group.random === 'object' ? group.random : {}
    ;(state.draft as any).groupRandomWeights = randomCfg.weightsByRoleId && typeof randomCfg.weightsByRoleId === 'object' ? { ...randomCfg.weightsByRoleId } : {}
    ;(state.draft as any).groupRandomMinCount = clamp(Math.round(Number(randomCfg.minCount ?? 1)), 1, 20)
    ;(state.draft as any).groupRandomMaxCount = clamp(Math.round(Number(randomCfg.maxCount ?? 2)), 1, 20)

    state.modal = 'group'
    render()
  }

  function saveGroupEditor() {
    if (!state.data) return
    ensureGroupsList()

    const gid = String((state.draft as any).editGroupId || '').trim()
    const name = String((state.draft as any).groupName || '').replace(/\s+/g, ' ').trim() || '未命名群组'
    const avatar = String((state.draft as any).groupAvatar || '').trim() || '👥'
    const avatarImage = looksLikeImageDataUrl((state.draft as any).groupAvatarImage) ? String((state.draft as any).groupAvatarImage || '') : ''
    const prompt = String((state.draft as any).groupPrompt || '').trim()
    const mode = String((state.draft as any).groupMode || '').trim() === 'random' ? 'random' : 'roundRobin'

    const roles = Array.isArray(state.data.roles) ? state.data.roles : []
    const roleIdSet = new Set(roles.map((r: any) => String(r?.id || '')).filter(Boolean))
    const members0 = Array.isArray((state.draft as any).groupMemberRoleIds) ? (state.draft as any).groupMemberRoleIds : []
    const memberRoleIds = Array.from(new Set(members0.map((x: any) => String(x || '').trim()).filter((x: any) => !!x && roleIdSet.has(x)))).slice(0, 50)
    if (!memberRoleIds.length) return api.ui?.showToast?.('请至少选择 1 个群组成员角色')

    const order0 = Array.isArray((state.draft as any).groupRoundRobinOrder) ? (state.draft as any).groupRoundRobinOrder : []
    const order = order0.map((x: any) => String(x || '').trim()).filter((x: any) => !!x && memberRoleIds.includes(x))
    const roundRobinOrder = order.length ? order : memberRoleIds.slice()

    const weights0 = (state.draft as any).groupRandomWeights && typeof (state.draft as any).groupRandomWeights === 'object' ? (state.draft as any).groupRandomWeights : {}
    const weightsByRoleId: any = {}
    for (const rid of memberRoleIds) {
      const w = Number((weights0 as any)[rid] ?? 1)
      weightsByRoleId[rid] = isFinite(w) && w >= 0 ? w : 1
    }
    let minCount = Number((state.draft as any).groupRandomMinCount ?? 1)
    let maxCount = Number((state.draft as any).groupRandomMaxCount ?? 2)
    if (!isFinite(minCount)) minCount = 1
    if (!isFinite(maxCount)) maxCount = 2
    minCount = clamp(Math.round(minCount), 1, 20)
    maxCount = clamp(Math.round(maxCount), 1, 20)
    if (maxCount < minCount) maxCount = minCount

    const nowT = now()
    const groups = (state.data as any).groups as any[]

    if (gid === NEW_GROUP_ID) {
      const newGid = uid('g')
      const chatId = uid('gc')
      const group = {
        id: newGid,
        name,
        avatar,
        avatarImage,
        prompt,
        mode,
        memberRoleIds,
        roundRobinOrder,
        random: { weightsByRoleId, minCount, maxCount },
        createdAt: nowT,
        updatedAt: nowT,
      }
      groups.unshift(group)
      ;(state.data as any).chatsByGroup[newGid] = {
        activeChatId: chatId,
        chats: [{ id: chatId, title: '群聊', createdAt: nowT, updatedAt: nowT, branching: createDefaultChatBranching('', nowT, nowT), messages: [] }],
      }
      ;(state.draft as any).activeTargetKind = 'group'
      ;(state.draft as any).activeGroupId = newGid
      save().catch(() => {})
      closeModal()
      return
    }

    const group = groups.find((g: any) => String(g?.id || '') === gid) || null
    if (!group) return

    group.name = name
    group.avatar = avatar
    group.avatarImage = avatarImage
    group.prompt = prompt
    group.mode = mode
    group.memberRoleIds = memberRoleIds
    group.roundRobinOrder = roundRobinOrder
    group.random = { weightsByRoleId, minCount, maxCount }
    group.updatedAt = nowT

    save().catch(() => {})
    closeModal()
  }

  function deleteGroup(groupId: any) {
    if (!state.data) return
    ensureGroupsList()
    const gid = String(groupId || '').trim()
    if (!gid) return

    ;(state.data as any).groups = ((state.data as any).groups as any[]).filter((g: any) => String(g?.id || '') !== gid)
    if ((state.data as any).chatsByGroup && typeof (state.data as any).chatsByGroup === 'object') delete (state.data as any).chatsByGroup[gid]

    const curKind = activeTargetKind()
    const curGid = String((state.draft as any).activeGroupId || '')
    if (curKind === 'group' && curGid === gid) {
      const next = Array.isArray((state.data as any).groups) ? (state.data as any).groups[0] : null
      if (next) {
        ;(state.draft as any).activeGroupId = String(next?.id || '')
      } else {
        ;(state.draft as any).activeTargetKind = 'role'
        ;(state.draft as any).activeGroupId = ''
      }
    }

    save().catch(() => {})
    render()
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
      const t = now()
      box.chats = [{ id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
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
    const t = now()
    const chat = { id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }
    box.chats.unshift(chat)
    box.activeChatId = cid
    return chat
  }

  function createChatForGroup(groupId: any) {
    const gid = String(groupId || '').trim()
    const box = ensureGroupChatsBox(gid)
    if (!box) return null
    const cid = uid('gc')
    const t = now()
    const chat = { id: cid, title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }
    box.chats.unshift(chat)
    box.activeChatId = cid
    return chat
  }

  function createChatForActiveRole() {
    const role = activeRole()
    if (!role) return api.ui?.showToast?.('请先选择角色')
    const rid = String(role.id || '')
    const t = now()
    state.pendingChat = {
      roleId: rid,
      chat: { id: uid('pc'), title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [], pendingLocal: true },
    }
    state.sideTab = 'chats'
    state.draft.input = ''
    state.draft.images = []
    render()
    scrollToBottomSoon()
  }

  function createChatForActiveGroup() {
    const group = activeGroup()
    if (!group) return api.ui?.showToast?.('请先选择群组')
    const gid = String((group as any).id || '').trim()
    if (!gid) return api.ui?.showToast?.('群组无效')
    const t = now()
    ;(state as any).pendingGroupChat = {
      groupId: gid,
      chat: { id: uid('pgc'), title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [], pendingLocal: true },
    }
    state.sideTab = 'chats'
    state.draft.input = ''
    state.draft.images = []
    ;(state.draft as any).files = []
    render()
    scrollToBottomSoon()
  }

  function createChatForActiveTarget() {
    if (activeTargetKind() === 'group') return createChatForActiveGroup()
    return createChatForActiveRole()
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

  function pickChatForActiveGroup(chatId: any) {
    const group = activeGroup()
    if (!group || !state.data) return
    clearPendingGroupChat()
    const box = ensureGroupChatsBox(String((group as any).id || ''))
    if (!box) return
    const cid = String(chatId || '')
    if (!cid || !box.chats.some((c: any) => String(c?.id) === cid)) return
    box.activeChatId = cid
    save().catch(() => {})
    render()
    scrollToBottomSoon()
  }

  function pickChatForActiveTarget(chatId: any) {
    if (activeTargetKind() === 'group') return pickChatForActiveGroup(chatId)
    return pickChatForActiveRole(chatId)
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

  function renameGroupChatTitle(groupId: any, chatId: any, title: any) {
    if (!state.data) return
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) return

    const box = ensureGroupChatsBoxBare(gid)
    if (!box) return
    const chats = Array.isArray(box.chats) ? box.chats : []
    const chat = chats.find((c: any) => String(c?.id) === cid) || null
    if (!chat) return

    let t = String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (t.length > 80) t = t.slice(0, 80).trim()
    chat.title = t || '群聊'

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

  function collectOtherChatsImagePathSetForGroup(excludeGroupId: string, excludeChatId: string): Set<string> {
    const out = new Set<string>()
    if (!state.data) return out

    const byRole: Record<string, any> = state.data.chatsByRole && typeof state.data.chatsByRole === 'object' ? (state.data.chatsByRole as any) : {}
    for (const box of Object.values(byRole)) {
      const chats = Array.isArray((box as any)?.chats) ? (box as any).chats : []
      for (const c of chats) {
        const paths = collectChatImagePathSet(c)
        for (const p of paths) {
          out.add(p)
          const base = imageBasename(p)
          if (base && base !== p) out.add(base)
        }
      }
    }

    const byGroup = (state.data as any).chatsByGroup && typeof (state.data as any).chatsByGroup === 'object' ? (state.data as any).chatsByGroup : {}
    for (const [gid, box] of Object.entries(byGroup)) {
      const chats = Array.isArray((box as any)?.chats) ? (box as any).chats : []
      for (const c of chats) {
        const cid = String((c as any)?.id || '')
        if (String(gid) === String(excludeGroupId || '') && cid === String(excludeChatId || '')) continue
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
      const t = now()
      box.chats = [{ id: nid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
      box.activeChatId = nid
    }

    void save()
      .then(() => deleteChatImages(toDeleteImages))
      .catch(() => {})
    render()
  }

  function deleteChatForGroup(groupId: any, chatId: any) {
    if (!state.data) return
    const gid = String(groupId || '').trim()
    const cid = String(chatId || '').trim()
    if (!gid || !cid) return

    const box = ensureGroupChatsBoxBare(gid)
    if (!box) return
    const before = Array.isArray(box.chats) ? box.chats : []
    const target = before.find((c: any) => String(c?.id) === cid) || null
    if (!target) return
    if (chatHasPendingAssistant(target)) {
      api.ui?.showToast?.('正在生成中，不能删除该会话')
      return
    }

    const targetImagePaths = collectChatImagePathSet(target)
    const otherImagePaths = targetImagePaths.size ? collectOtherChatsImagePathSetForGroup(gid, cid) : new Set<string>()
    const toDeleteImages: string[] = []
    for (const p of targetImagePaths) {
      const base = imageBasename(p)
      if (!otherImagePaths.has(p) && (!base || !otherImagePaths.has(base))) toDeleteImages.push(p)
    }

    box.chats = before.filter((c: any) => String(c?.id) !== cid)
    if (String(box.activeChatId || '') === cid) box.activeChatId = String(box.chats[0]?.id || '')

    if (!box.chats.length) {
      const nid = uid('gc')
      const t = now()
      box.chats = [{ id: nid, title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
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
        state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
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
    if (act === 'new-chat') return createChatForActiveTarget()

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

    if (act === 'pick-chat') return pickChatForActiveTarget(String(t.getAttribute('data-id') || ''))

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
    state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
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
      chatTitleNamingSystemPrompt: DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
      stickerNamingSystemPrompt: DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
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
        clearPendingGroupChat()
        state.branchDraft = null
        ;(state.draft as any).activeTargetKind = 'role'
        state.draft.activeRoleId = String(roleId || '')
        ensureChatsBox(state.draft.activeRoleId)
        save().catch(() => {})
        emit()
      },
      setActiveGroup: (groupId) => {
        clearPendingChat()
        clearPendingGroupChat()
        state.branchDraft = null
        ;(state.draft as any).activeTargetKind = 'group'
        ;(state.draft as any).activeGroupId = String(groupId || '')
        ensureGroupChatsBox((state.draft as any).activeGroupId)
        save().catch(() => {})
        emit()
      },
      setActiveChat: (chatId) => {
        state.branchDraft = null
        pickChatForActiveTarget(String(chatId || ''))
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
      setToolRequestRenderPreset: (preset) => {
        if (!state.data) return
        const v = String(preset || '').trim().slice(0, 60)
        state.data.settings.toolRequestRenderPreset = v || 'classic'
        save().catch(() => {})
        emit()
      },
      setBranchTreeDir: (dir) => {
        if (!state.data) return
        if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {}
        if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
          (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
        const v = String(dir || '').trim()
        const ok = v === 'lr' || v === 'tb' || v === 'bt' || v === 'rl'
        ;(state.data.settings as any).branchTree.dir = ok ? v : 'lr'
        save().catch(() => {})
        emit()
      },
      setBranchTreeView: (view) => {
        if (!state.data) return
        if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {}
        if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
          (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
        const v = String(view || '').trim()
        const ok = v === 'right' || v === 'float'
        ;(state.data.settings as any).branchTree.view = ok ? v : 'right'
        save().catch(() => {})
        emit()
      },
      setBranchTreeFollowSelected: (enabled) => {
        if (!state.data) return
        if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {}
        if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
          (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
        ;(state.data.settings as any).branchTree.followSelected = !!enabled
        save().catch(() => {})
        emit()
      },
      setBranchTreeModalHotkey: (hotkey) => {
        if (!state.data) return
        if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {}
        if (!(state.data.settings as any).branchTree || typeof (state.data.settings as any).branchTree !== 'object')
          (state.data.settings as any).branchTree = { dir: 'lr', view: 'right', followSelected: true, modalHotkey: '' }
        const v = String(hotkey || '').trim().slice(0, 80)
        ;(state.data.settings as any).branchTree.modalHotkey = v
        save().catch(() => {})
        emit()
      },
      cloneToolRequestRenderPreset: (sourceId) => {
        if (!state.data) return
        const sid = String(sourceId || '').trim()
        if (!sid) return

        const userPresets = (state.data.settings as any).toolRequestRenderPresets
        const list = Array.isArray(userPresets) ? userPresets : []

        const builtin = findBuiltinToolRequestPreset(sid)
        const fromUser = list.find((x: any) => x && typeof x === 'object' && String(x?.id || '').trim() === sid) || null
        const src = builtin || fromUser
        if (!src) return api.ui?.showToast?.('未找到预设')

        const base = stringifyToolRequestRenderPreset(src)
        let obj: any = null
        try {
          obj = JSON.parse(base || '{}')
        } catch (_) {}
        if (!obj || typeof obj !== 'object') return api.ui?.showToast?.('复制失败（预设异常）')

        const genId = () => {
          const id = uid('tp').slice(0, 60)
          return id.replace(/[^a-zA-Z0-9._-]/g, '_')
        }
        const existingIds = new Set<string>([...BUILTIN_TOOL_REQUEST_PRESETS.map((x) => x.id), ...list.map((x: any) => String(x?.id || '').trim())])
        let nextId = ''
        for (let i = 0; i < 8; i++) {
          const tryId = genId()
          if (!existingIds.has(tryId)) {
            nextId = tryId
            break
          }
        }
        if (!nextId) return api.ui?.showToast?.('复制失败（id 冲突）')

        obj.id = nextId
        obj.name = `${String(obj.name || '预设').trim() || '预设'}（副本）`.slice(0, 60)

        const v = validateToolRequestRenderPreset(obj)
        if (!v.ok || !v.preset) return api.ui?.showToast?.(v.error || '复制失败（预设无效）')

        ;(state.data.settings as any).toolRequestRenderPresets = normalizeToolRequestRenderPresets(list.concat([v.preset]))
        state.data.settings.toolRequestRenderPreset = v.preset.id
        save().catch(() => {})
        emit()
        api.ui?.showToast?.('已复制预设')
      },
      deleteToolRequestRenderPreset: (presetId) => {
        if (!state.data) return
        const id = String(presetId || '').trim()
        if (!id) return
        const list = Array.isArray((state.data.settings as any).toolRequestRenderPresets) ? ((state.data.settings as any).toolRequestRenderPresets as any[]) : []
        const next = list.filter((x: any) => String(x?.id || '').trim() !== id)
        ;(state.data.settings as any).toolRequestRenderPresets = normalizeToolRequestRenderPresets(next)
        if (String(state.data.settings.toolRequestRenderPreset || '').trim() === id) state.data.settings.toolRequestRenderPreset = 'classic'
        save().catch(() => {})
        emit()
        api.ui?.showToast?.('已删除预设')
      },
      importToolRequestRenderPresetJson: (jsonText) => {
        if (!state.data) return
        const raw = String(jsonText || '').trim()
        if (!raw) return api.ui?.showToast?.('请输入 JSON')

        let parsed: any = null
        try {
          parsed = JSON.parse(raw)
        } catch (e: any) {
          return api.ui?.showToast?.(`JSON 解析失败：${String(e?.message || e || 'unknown')}`)
        }

        const items = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.presets) ? parsed.presets : [parsed]
        if (!items.length) return api.ui?.showToast?.('JSON 里没有预设')

        const list = Array.isArray((state.data.settings as any).toolRequestRenderPresets) ? ((state.data.settings as any).toolRequestRenderPresets as any[]) : []
        const map = new Map<string, any>(list.map((x: any) => [String(x?.id || '').trim(), x]))

        let ok = 0
        let bad = 0
        for (const it of items) {
          const v = validateToolRequestRenderPreset(it)
          if (!v.ok || !v.preset) {
            bad++
            continue
          }
          map.set(v.preset.id, v.preset)
          ok++
          if (ok >= 60) break
        }

        ;(state.data.settings as any).toolRequestRenderPresets = normalizeToolRequestRenderPresets(Array.from(map.values()))
        save().catch(() => {})
        emit()
        api.ui?.showToast?.(bad ? `导入完成：成功 ${ok}，失败 ${bad}` : `导入完成：成功 ${ok}`)
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
      setAttachmentsSendLimitChars: (chars, commit) => {
        if (!state.data) return
        if (!state.data.settings.attachments || typeof state.data.settings.attachments !== 'object') {
          state.data.settings.attachments = { sendLimitChars: DEFAULT_ATTACH_SEND_LIMIT_CHARS }
        }
        const at = state.data.settings.attachments
        at.sendLimitChars = clamp(Math.round(Number(chars || DEFAULT_ATTACH_SEND_LIMIT_CHARS)), 1000, 2_000_000)
        if (commit) save().catch(() => {})
        emit()
      },
      setAttachmentsMaxFileSizeMb: (kind, mb, commit) => {
        if (!state.data) return
        const k = String(kind || '').trim()
        if (!CHAT_ATTACHMENT_KINDS.has(k)) return
        if (!state.data.settings.attachments || typeof state.data.settings.attachments !== 'object') {
          state.data.settings.attachments = { sendLimitChars: DEFAULT_ATTACH_SEND_LIMIT_CHARS, maxFileSizeMbByKind: {} }
        }
        const at = state.data.settings.attachments as any
        if (!at.maxFileSizeMbByKind || typeof at.maxFileSizeMbByKind !== 'object') at.maxFileSizeMbByKind = {}
        const n = Number(mb)
        const next = !isFinite(n) ? DEFAULT_ATTACH_MAX_FILE_MB : clamp(Math.round(n), 0, MAX_ATTACH_MAX_FILE_MB)
        at.maxFileSizeMbByKind[k] = next
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
      setChatTitleNamingEnabled: (on) => {
        if (!state.data) return
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {}
        state.data.settings.aiServices.chatTitleNaming.enabled = !!on
        save().catch(() => {})
        emit()
      },
      setChatTitleNamingProviderId: (providerId) => {
        if (!state.data) return
        const pid = String(providerId || '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {}
        state.data.settings.aiServices.chatTitleNaming.providerId = pid
        save().catch(() => {})
        emit()
      },
      setChatTitleNamingModelId: (modelId) => {
        if (!state.data) return
        const mid = String(modelId || '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {}
        state.data.settings.aiServices.chatTitleNaming.modelId = mid
        save().catch(() => {})
        emit()
      },
      setChatTitleNamingCustomModelId: (customModelId) => {
        if (!state.data) return
        const mid = String(customModelId || '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {}
        state.data.settings.aiServices.chatTitleNaming.customModelId = mid
        save().catch(() => {})
        emit()
      },
      setChatTitleNamingSystemPrompt: (systemPrompt) => {
        if (!state.data) return
        const p = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {}
        state.data.settings.aiServices.chatTitleNaming.systemPrompt = p
        save().catch(() => {})
        emit()
      },
      resetChatTitleNamingSystemPromptDefault: () => {
        if (!state.data) return
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.chatTitleNaming || typeof state.data.settings.aiServices.chatTitleNaming !== 'object') state.data.settings.aiServices.chatTitleNaming = {}
        state.data.settings.aiServices.chatTitleNaming.systemPrompt = DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT
        save().catch(() => {})
        emit()
      },
      setStickerNamingEnabled: (on) => {
        if (!state.data) return
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {}
        state.data.settings.aiServices.stickerNaming.enabled = !!on
        save().catch(() => {})
        emit()
      },
      setStickerNamingProviderId: (providerId) => {
        if (!state.data) return
        const pid = String(providerId || '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {}
        state.data.settings.aiServices.stickerNaming.providerId = pid
        save().catch(() => {})
        emit()
      },
      setStickerNamingModelId: (modelId) => {
        if (!state.data) return
        const mid = String(modelId || '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {}
        state.data.settings.aiServices.stickerNaming.modelId = mid
        save().catch(() => {})
        emit()
      },
      setStickerNamingCustomModelId: (customModelId) => {
        if (!state.data) return
        const mid = String(customModelId || '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {}
        state.data.settings.aiServices.stickerNaming.customModelId = mid
        save().catch(() => {})
        emit()
      },
      setStickerNamingSystemPrompt: (systemPrompt) => {
        if (!state.data) return
        const p = typeof systemPrompt === 'string' ? systemPrompt : String(systemPrompt ?? '')
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {}
        state.data.settings.aiServices.stickerNaming.systemPrompt = p
        save().catch(() => {})
        emit()
      },
      resetStickerNamingSystemPromptDefault: () => {
        if (!state.data) return
        if (!state.data.settings.aiServices || typeof state.data.settings.aiServices !== 'object') state.data.settings.aiServices = {}
        if (!state.data.settings.aiServices.stickerNaming || typeof state.data.settings.aiServices.stickerNaming !== 'object') state.data.settings.aiServices.stickerNaming = {}
        state.data.settings.aiServices.stickerNaming.systemPrompt = DEFAULT_STICKER_NAMING_SYSTEM_PROMPT
        save().catch(() => {})
        emit()
      },
      setToolCallServerBaseUrl: (baseUrl) => {
        if (!state.data) return
        const v = String(baseUrl ?? '').trim()
        if (!state.data.settings.toolCallServer || typeof state.data.settings.toolCallServer !== 'object') state.data.settings.toolCallServer = {}
        state.data.settings.toolCallServer.baseUrl = v || DEFAULT_TOOL_CALL_SERVER_BASE_URL
        saveMetaOnly().catch(() => {})
        emit()
      },
      setToolCallServerToken: (token) => {
        if (!state.data) return
        const v = typeof token === 'string' ? token : String(token ?? '')
        if (!state.data.settings.toolCallServer || typeof state.data.settings.toolCallServer !== 'object') state.data.settings.toolCallServer = {}
        state.data.settings.toolCallServer.token = v
        saveMetaOnly().catch(() => {})
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
        ;(state.draft as any).deleteGroupId = ''
        state.modal = 'confirm'
        emit()
      },
      openRoleEditor: (roleId) => openRoleEditor(String(roleId || '')),
      createRole: () => createRole(),
      saveRole: () => saveRoleEditor(),
      openGroupEditor: (groupId) => openGroupEditor(String(groupId || '')),
      createGroup: () => createGroup(),
      saveGroup: () => saveGroupEditor(),
      askDeleteRole: (roleId) => {
        const rid = String(roleId || '')
        if (!rid || rid === NEW_ROLE_ID) return
        state.draft.deleteRoleId = rid
        ;(state.draft as any).deleteGroupId = ''
        state.draft.deleteProviderId = ''
        state.modal = 'confirm'
        emit()
      },
      askDeleteGroup: (groupId) => {
        const gid = String(groupId || '')
        if (!gid || gid === NEW_GROUP_ID) return
        ;(state.draft as any).deleteGroupId = gid
        state.draft.deleteRoleId = ''
        state.draft.deleteProviderId = ''
        state.modal = 'confirm'
        emit()
      },
      confirmDelete: () => {
        const rid = String(state.draft.deleteRoleId || '')
        const gid = String((state.draft as any).deleteGroupId || '')
        const pid = String(state.draft.deleteProviderId || '')
        closeModal()
        if (rid) deleteRole(rid)
        if (gid) deleteGroup(gid)
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
        state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
        emit()
      },
      mermaidSetScale: (scale) => {
        state.mermaid.scale = clamp(Number(scale || 1), VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
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
        state.imageViewer.scale = clamp(Number(state.imageViewer.scale || 1) * factor, VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
        emit()
      },
      imageSetScale: (scale) => {
        state.imageViewer.scale = clamp(Number(scale || 1), VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
        emit()
      },
      imageReset: () => {
        state.imageViewer.scale = 1
        emit()
      },
      createChat: () => {
        return createChatForActiveTarget()
      },
      aiGenerateChatTitle: (roleId, chatId) =>
        Promise.resolve()
          .then(() => {
            api.ui?.showToast?.('AI 生成标题中…')
            return aiGenerateChatTitle(String(roleId || ''), String(chatId || ''))
          })
          .then((title) => {
            api.ui?.showToast?.(`已更新标题：${String(title || '').trim() || '（空）'}`)
            return title
          })
          .catch((e) => {
            api.ui?.showToast?.(String(e?.message || e || 'AI 生成标题失败'))
            throw e
          }),
      aiGenerateGroupChatTitle: (groupId, chatId) =>
        Promise.resolve()
          .then(() => {
            api.ui?.showToast?.('AI 生成标题中…')
            return aiGenerateGroupChatTitle(String(groupId || ''), String(chatId || ''))
          })
          .then((title) => {
            api.ui?.showToast?.(`已更新标题：${String(title || '').trim() || '（空）'}`)
            return title
          })
          .catch((e) => {
            api.ui?.showToast?.(String(e?.message || e || 'AI 生成标题失败'))
            throw e
          }),
      aiGenerateStickerName: (categoryName, stickerName) =>
        Promise.resolve()
          .then(() => {
            api.ui?.showToast?.('AI 取名中…')
            return aiGenerateStickerName(String(categoryName || ''), String(stickerName || ''))
          })
          .then((name) => {
            api.ui?.showToast?.(`已更新表情名：${String(name || '').trim() || '（空）'}`)
            return name
          })
          .catch((e) => {
            api.ui?.showToast?.(String(e?.message || e || 'AI 取名失败'))
            throw e
          }),
      renameChat: (roleId, chatId, title) => renameChatTitle(String(roleId || ''), String(chatId || ''), String(title ?? '')),
      renameGroupChat: (groupId, chatId, title) => renameGroupChatTitle(String(groupId || ''), String(chatId || ''), String(title ?? '')),
      deleteChat: (roleId, chatId) => deleteChatForRole(String(roleId || ''), String(chatId || '')),
      deleteGroupChat: (groupId, chatId) => deleteChatForGroup(String(groupId || ''), String(chatId || '')),
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
      pickGroupAvatarImage: () => pickGroupAvatarImage(),
      clearGroupAvatarImage: () => clearGroupAvatarImage(),
      removeDraftImage: (id) => {
        removeDraftImage(String(id || ''))
        emit()
      },
      removeDraftFile: (id) => {
        removeDraftFile(String(id || ''))
        emit()
      },
      setDraftFileSendPct: (id, pct) => {
        const rid = String(id || '')
        if (!rid) return
        if (!Array.isArray(state.draft.files)) state.draft.files = []
        const it = state.draft.files.find((x: any) => String(x?.id || '') === rid)
        if (!it) return
        it.sendPct = clamp(Math.round(Number(pct ?? 100)), 0, 100)
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
      sendFromMid: (forkFromMid) => sendChat({ forkFromMid: String(forkFromMid || '') }),
      stop: () => {
        stopSending().catch(() => {})
      },
      regenerateAssistant: (assistantMid) => regenerateAssistantMessage(String(assistantMid || '')),
      replyFromUserMessage: (userMid) => replyFromUserMessage(String(userMid || '')),
      createBranchFromAssistant: (assistantMid) => createParallelBranchFromAssistantMessage(String(assistantMid || '')),
      switchBranchSibling: (assistantMid, delta) => switchBranchByAssistantSibling(String(assistantMid || ''), Number(delta || 0)),
      setActiveBranch: (branchId) => setActiveBranch(String(branchId || '')),
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
      deleteMessageSubtree: (messageId) => deleteMessageSubtree(String(messageId || '')),
      editMessage: (messageId, content) => editMessage(String(messageId || ''), content),
    },
  }

  init()
})()
