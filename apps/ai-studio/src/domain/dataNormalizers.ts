import { now, uid, clamp, normImagePaths } from '../core/utils'
import {
  VERSION,
  SPLIT_SCHEMA_VERSION,
  DEFAULT_ATTACH_MAX_FILE_MB,
  MAX_ATTACH_MAX_FILE_MB,
  DEFAULT_ATTACH_SEND_LIMIT_CHARS,
  DEFAULT_TOOL_CALL_SERVER_BASE_URL,
  DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
  DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
  DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
} from './constants'
import {
  normalizeBranchId,
  createDefaultChatBranching,
  normalizeChatBranching,
  rebuildLinearBranchingMessages,
  fillMissingBranchIdsOnly,
} from './branching'
import { normalizeMessageAttachments, normalizeMessageGroup } from './message'
import { normalizeFavorites } from './favorites'
import { chatMetasFromBox } from './chatMeta'
import { looksLikeImageDataUrl } from './textProcessing'
import { normalizeChatModelOverride, normalizeMessageModelRef } from './modelRefUtils'
import { normalizeToolRequestRenderPresets } from '../core/toolRequestPresets'

export function normalizeRenderSafetyPolicy(v0: unknown) {
  const v = String(v0 || '').trim()
  if (v === 'unsafe') return 'unsafe'
  if (v === 'baseline' || v === 'minimal') return 'baseline'
  return 'original'
}

export function normalizeMaxFileSizeMb(v: unknown) {
  const n = Number(v)
  if (!isFinite(n)) return DEFAULT_ATTACH_MAX_FILE_MB
  return clamp(Math.round(n), 0, MAX_ATTACH_MAX_FILE_MB)
}

export function normalizeSplitMeta(raw: any) {
  if (!raw || typeof raw !== 'object') return null
  const schemaVersion = Number(raw.schemaVersion || 0)
  if (schemaVersion !== SPLIT_SCHEMA_VERSION) return null

  const roleOrder = Array.isArray(raw.roleOrder) ? raw.roleOrder.map((x: any) => String(x || '')).filter((x: any) => !!x) : []
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
    favorites: normalizeFavorites((raw as any).favorites),
    roleOrder,
    roleFolders,
    chatIndexByRole,
    groupOrder,
    groupFolders,
    chatIndexByGroup,
  }
}

export function defaultData() {
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
      branchTree: { dir: 'lr', view: 'float', followSelected: true, modalHotkey: '' },
      toolRequestRenderPreset: 'classic',
      toolRequestRenderPresets: [],
      renderSafetyPolicy: 'original',
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
    favorites: { folders: [], chatRefsByFolderId: {} },
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

export function normalizeData(raw: any) {
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
  btree.view = okView ? view0 : 'float'
  if (typeof btree.followSelected !== 'boolean') btree.followSelected = true
  if (typeof btree.modalHotkey !== 'string') btree.modalHotkey = ''
  btree.modalHotkey = String(btree.modalHotkey || '').trim().slice(0, 80)
  if (typeof d.settings.toolRequestRenderPreset !== 'string') d.settings.toolRequestRenderPreset = 'classic'
  ;(d.settings as any).toolRequestRenderPresets = normalizeToolRequestRenderPresets((d.settings as any).toolRequestRenderPresets)
  ;(d.settings as any).renderSafetyPolicy = normalizeRenderSafetyPolicy((d.settings as any).renderSafetyPolicy)
  if (typeof d.settings.userMessageCollapseEnabled !== 'boolean') d.settings.userMessageCollapseEnabled = false
  if (typeof d.settings.userMessageCollapseLines !== 'number' || !isFinite(d.settings.userMessageCollapseLines)) d.settings.userMessageCollapseLines = 8
  if (!d.settings.attachments || typeof d.settings.attachments !== 'object') d.settings.attachments = {}
  const at = d.settings.attachments
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
  ;(d.settings as any).renderSafetyPolicy = normalizeRenderSafetyPolicy((d.settings as any).renderSafetyPolicy)
  d.settings.userMessageCollapseLines = clamp(Math.round(Number(d.settings.userMessageCollapseLines || 8)), 1, 50)
  at.sendLimitChars = clamp(Math.round(Number(at.sendLimitChars || DEFAULT_ATTACH_SEND_LIMIT_CHARS)), 1000, 2_000_000)

  if (!at.maxFileSizeMbByKind || typeof at.maxFileSizeMbByKind !== 'object') (at as any).maxFileSizeMbByKind = {}
  const mb = (at as any).maxFileSizeMbByKind
  mb.txt = normalizeMaxFileSizeMb(mb.txt)
  mb.md = normalizeMaxFileSizeMb(mb.md)
  mb.pdf = normalizeMaxFileSizeMb(mb.pdf)
  mb.docx = normalizeMaxFileSizeMb(mb.docx)
  mb.ppt = normalizeMaxFileSizeMb(mb.ppt)
  if (!Array.isArray(d.settings.providers) || d.settings.providers.length === 0) d.settings.providers = defaultData().settings.providers

  if (!d.settings.stickers || typeof d.settings.stickers !== 'object') d.settings.stickers = {}
  const st = d.settings.stickers
  if (typeof st.enabled !== 'boolean') st.enabled = false
  if (!Array.isArray(st.categories)) st.categories = []
  if (!st.map || typeof st.map !== 'object') st.map = {}

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
  if (!mm.providerId || !d.settings.providers.some((p: any) => String(p?.id || '') === String(mm.providerId || ''))) mm.providerId = fallbackPid
  if (typeof mm.modelId !== 'string') mm.modelId = ''
  if (typeof mm.customModelId !== 'string') mm.customModelId = ''
  if (typeof mm.systemPrompt !== 'string') mm.systemPrompt = DEFAULT_MERMAID_FIX_SYSTEM_PROMPT

  if (!as.chatTitleNaming || typeof as.chatTitleNaming !== 'object') as.chatTitleNaming = {}
  const ctn = as.chatTitleNaming as any
  if (typeof ctn.enabled !== 'boolean') ctn.enabled = false
  if (typeof ctn.providerId !== 'string') ctn.providerId = fallbackPid
  if (!ctn.providerId || !d.settings.providers.some((p: any) => String(p?.id || '') === String(ctn.providerId || ''))) ctn.providerId = fallbackPid
  if (typeof ctn.modelId !== 'string') ctn.modelId = ''
  if (typeof ctn.customModelId !== 'string') ctn.customModelId = ''
  if (typeof ctn.systemPrompt !== 'string') ctn.systemPrompt = DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT

  if (!as.stickerNaming || typeof as.stickerNaming !== 'object') as.stickerNaming = {}
  const sn = as.stickerNaming as any
  if (typeof sn.enabled !== 'boolean') sn.enabled = false
  if (typeof sn.providerId !== 'string') sn.providerId = fallbackPid
  if (!sn.providerId || !d.settings.providers.some((p: any) => String(p?.id || '') === String(sn.providerId || ''))) sn.providerId = fallbackPid
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

  ;(d as any).favorites = normalizeFavorites((d as any).favorites)

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
    if (!d.settings.providers.some((p: any) => String(p?.id || '') === pid)) r.modelRef.providerId = String(d.settings.providers[0]?.id || '')
    r.createdAt = Number(r.createdAt || now())
    r.updatedAt = Number(r.updatedAt || now())
  }

  if (!d.chatsByRole || typeof d.chatsByRole !== 'object') d.chatsByRole = {}
  for (const r of d.roles) {
    const rid = String(r.id)
    if (!d.chatsByRole[rid] || typeof d.chatsByRole[rid] !== 'object') d.chatsByRole[rid] = { activeChatId: '', chats: [] }
    const box = d.chatsByRole[rid]
    if (!Array.isArray(box.chats)) box.chats = []
    box.chatMetas = chatMetasFromBox(box, '新聊天')
    box.activeChatId = String(box.activeChatId || '')

    box.chats = box.chats
      .filter((c: any) => c && typeof c === 'object')
      .map((c: any) => {
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
              modelRef: normalizeMessageModelRef(m),
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

    if (!box.chats.length && !box.chatMetas.length) {
      const cid = uid('c')
      const t = now()
      box.chats = [{ id: cid, title: '新聊天', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
      box.chatMetas = chatMetasFromBox(box, '新聊天')
      box.activeChatId = cid
    }

    const roleMetaIds = box.chatMetas.map((m: any) => String(m?.id || '')).filter(Boolean)
    if (!box.activeChatId || (!box.chats.some((c: any) => String(c.id) === box.activeChatId) && !roleMetaIds.includes(box.activeChatId))) {
      box.activeChatId = String(box.chats[0]?.id || roleMetaIds[0] || '')
    }
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
    box.chatMetas = chatMetasFromBox(box, '群聊')
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

    if (!box.chats.length && !box.chatMetas.length) {
      const cid = uid('gc')
      const t = now()
      box.chats = [{ id: cid, title: '群聊', createdAt: t, updatedAt: t, branching: createDefaultChatBranching('', t, t), messages: [] }]
      box.chatMetas = chatMetasFromBox(box, '群聊')
      box.activeChatId = cid
    }
    const groupMetaIds = box.chatMetas.map((m: any) => String(m?.id || '')).filter(Boolean)
    if (!box.activeChatId || (!box.chats.some((c: any) => String(c.id) === box.activeChatId) && !groupMetaIds.includes(box.activeChatId))) {
      box.activeChatId = String(box.chats[0]?.id || groupMetaIds[0] || '')
    }
  }

  const targetKind0 = String((d.ui as any).activeTargetKind || '').trim()
  const targetKind = targetKind0 === 'group' ? 'group' : 'role'
  ;(d.ui as any).activeTargetKind = targetKind

  const activeRoleId = String(d.ui.activeRoleId || '')
  if (!activeRoleId || !d.roles.some((r: any) => String(r?.id) === activeRoleId)) d.ui.activeRoleId = String(d.roles[0]?.id || '')

  const activeGroupId = String((d.ui as any).activeGroupId || '').trim()
  if (activeGroupId && !(d as any).groups.some((g: any) => String(g?.id || '') === activeGroupId)) (d.ui as any).activeGroupId = ''

  const hasGroups = !!((d as any).groups && (d as any).groups.length)
  if (targetKind === 'group' && !hasGroups) (d.ui as any).activeTargetKind = 'role'

  return d
}
