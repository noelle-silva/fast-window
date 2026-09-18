import { now, uid, clamp, normalizeTimeMs } from '../core/utils'
import {
  VERSION,
  SPLIT_SCHEMA_VERSION,
  DEFAULT_ATTACH_MAX_FILE_MB,
  MAX_ATTACH_MAX_FILE_MB,
  DEFAULT_ATTACH_SEND_LIMIT_CHARS,
  DEFAULT_MERMAID_FIX_SYSTEM_PROMPT,
  DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT,
  DEFAULT_STICKER_NAMING_SYSTEM_PROMPT,
  DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
  CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
  CHAT_BRANCHING_SCHEMA_VERSION,
} from './constants'
import {
  normalizeBranchId,
  createDefaultChatBranching,
  normalizeChatBranching,
  rebuildLinearBranchingMessages,
  fillMissingBranchIdsOnly,
} from './branching'
import { hasExplicitMessageParentLinks, normalizeChatMessage } from './message'
import { normalizeFavorites } from './favorites'
import { chatMetasFromBox } from './chatMeta'
import { looksLikeImageDataUrl } from './textProcessing'
import { normalizeRoleToolPolicy } from './toolPolicy'
import { normalizeReasoningEffort, normalizeReasoningFields } from './reasoning'
import { normalizeSessionFacts } from './sessionFacts'
import { parseWorkspaceRoleTargetId } from './workspaceRoleTarget'
import { COLOR_THEME_SETTING_KEY, normalizeColorThemeSettings } from './colorTheme'

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

function normalizeAsyncToolTasks(raw: unknown) {
  const list = Array.isArray(raw) ? raw : []
  return list
    .filter((task: any) => task && typeof task === 'object')
    .map((task: any) => ({
      ...task,
      id: String(task?.id || '').trim(),
      runId: String(task?.runId || '').trim(),
      roleId: String(task?.roleId || '').trim(),
      groupId: String(task?.groupId || '').trim(),
      workspaceId: String(task?.workspaceId || '').trim(),
      sessionId: String(task?.sessionId || '').trim(),
      taskName: String(task?.taskName || task?.toolName || '').trim(),
      toolName: String(task?.toolName || '').trim(),
      status: String(task?.status || '').trim(),
    }))
    .filter((task: any) => !!task.id)
}

function normalizeAiServiceModelSelection(service: any, providers: any[]) {
  const fallbackPid = String(providers?.[0]?.id || '')
  const groupId = typeof service.groupId === 'string' ? String(service.groupId || '').trim() : ''
  const kind = groupId || String(service.kind || '').trim() === 'model_group' ? 'model_group' : 'provider'
  service.kind = kind
  if (kind === 'model_group') {
    service.groupId = groupId
    service.providerId = ''
  } else {
    if (typeof service.providerId !== 'string') service.providerId = fallbackPid
    if (!service.providerId || !providers.some((p: any) => String(p?.id || '') === String(service.providerId || ''))) service.providerId = fallbackPid
    service.groupId = ''
  }
  if (typeof service.modelId !== 'string') service.modelId = ''
  if (service.modelId === '__custom__') service.modelId = ''
  service.customModelId = ''
}

function hasStoredBranching(raw: unknown) {
  return !!raw && typeof raw === 'object' && Number((raw as any).schemaVersion || 0) === CHAT_BRANCHING_SCHEMA_VERSION
}

function normalizedBranchHeadMid(branchesRaw: unknown, activeBranchId: string, messages: any[], fallbackHeadMid: string, preserveCurrentHead: boolean) {
  const branches = Array.isArray(branchesRaw) ? branchesRaw : []
  const messageIds = new Set<string>()
  const parentIds = new Set<string>()
  for (const message of messages) {
    const id = String(message?.id || '').trim()
    if (id) messageIds.add(id)
    const parentMid = String(message?.parentMid || message?.parentMessageId || '').trim()
    if (parentMid) parentIds.add(parentMid)
  }
  const activeBranch = branches.find((branch: any) => String(branch?.id || '') === activeBranchId) || null
  const currentHeadMid = String(activeBranch?.headMid || '').trim()
  if (preserveCurrentHead && currentHeadMid && messageIds.has(currentHeadMid)) return currentHeadMid
  for (let index = messages.length - 1; index >= 0; index--) {
    const id = String(messages[index]?.id || '').trim()
    if (id && !parentIds.has(id)) return id
  }
  return String(fallbackHeadMid || '').trim()
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
  const workspaceOrder = Array.isArray((raw as any).workspaceOrder) ? (raw as any).workspaceOrder.map((x: any) => String(x || '')).filter((x: any) => !!x) : []
  const workspaceFolders = (raw as any).workspaceFolders && typeof (raw as any).workspaceFolders === 'object' ? (raw as any).workspaceFolders : {}
  const chatIndexByWorkspace =
    (raw as any).chatIndexByWorkspace && typeof (raw as any).chatIndexByWorkspace === 'object' ? (raw as any).chatIndexByWorkspace : {}

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
    workspaceOrder,
    workspaceFolders,
    chatIndexByWorkspace,
  }
}

export function normalizeData(raw: any) {
  const d0 = raw && typeof raw === 'object' ? raw : {}

  if (d0.version !== VERSION) throw new Error(`数据版本不支持：${String(d0.version)}（期望 ${VERSION}）`)
  const d = d0

  if (!d.settings || typeof d.settings !== 'object') d.settings = {}
  if (typeof d.settings.transparentChatBg !== 'boolean') d.settings.transparentChatBg = false
  if (typeof d.settings.chatBgOpacity !== 'number' || !isFinite(d.settings.chatBgOpacity)) d.settings.chatBgOpacity = 0
  if (typeof d.settings.chatBgBlur !== 'number' || !isFinite(d.settings.chatBgBlur)) d.settings.chatBgBlur = 0
  if (typeof d.settings.topbarOpacity !== 'number' || !isFinite(d.settings.topbarOpacity)) d.settings.topbarOpacity = 100
  if (typeof d.settings.topbarBlur !== 'number' || !isFinite(d.settings.topbarBlur)) d.settings.topbarBlur = 0
  if (typeof d.settings.composerOpacity !== 'number' || !isFinite(d.settings.composerOpacity)) d.settings.composerOpacity = 86
  if (typeof d.settings.composerBlur !== 'number' || !isFinite(d.settings.composerBlur)) d.settings.composerBlur = 10
  ;(d.settings as any)[COLOR_THEME_SETTING_KEY] = normalizeColorThemeSettings((d.settings as any)[COLOR_THEME_SETTING_KEY])
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
  if (!Array.isArray(d.settings.providers)) d.settings.providers = []

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
  normalizeAiServiceModelSelection(mm, d.settings.providers)
  if (typeof mm.systemPrompt !== 'string') mm.systemPrompt = DEFAULT_MERMAID_FIX_SYSTEM_PROMPT

  if (!as.chatTitleNaming || typeof as.chatTitleNaming !== 'object') as.chatTitleNaming = {}
  const ctn = as.chatTitleNaming as any
  if (typeof ctn.enabled !== 'boolean') ctn.enabled = false
  normalizeAiServiceModelSelection(ctn, d.settings.providers)
  if (typeof ctn.systemPrompt !== 'string') ctn.systemPrompt = DEFAULT_CHAT_TITLE_NAMING_SYSTEM_PROMPT

  if (!as.stickerNaming || typeof as.stickerNaming !== 'object') as.stickerNaming = {}
  const sn = as.stickerNaming as any
  if (typeof sn.enabled !== 'boolean') sn.enabled = false
  normalizeAiServiceModelSelection(sn, d.settings.providers)
  if (typeof sn.systemPrompt !== 'string') sn.systemPrompt = DEFAULT_STICKER_NAMING_SYSTEM_PROMPT

  if (!as.contextCompression || typeof as.contextCompression !== 'object') as.contextCompression = {}
  const cc = as.contextCompression as any
  normalizeAiServiceModelSelection(cc, d.settings.providers)
  cc.retainRecentMessages = clamp(
    Math.round(Number(cc.retainRecentMessages || DEFAULT_CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES)),
    CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MIN,
    CONTEXT_COMPRESSION_RETAIN_RECENT_MESSAGES_MAX,
  )

  for (const p of d.settings.providers) {
    if (!p || typeof p !== 'object') continue
    if (typeof p.name !== 'string' || !p.name.trim()) p.name = '未命名供应商'
    if (typeof p.id !== 'string' || !p.id.trim()) p.id = String(p.name || '').trim() || uid('p')
    if (typeof p.baseUrl !== 'string' || !p.baseUrl.trim()) p.baseUrl = 'http://'
    if (typeof p.apiKey !== 'string') p.apiKey = ''
    p.apiKeyStrategy = String(p.apiKeyStrategy || '') === 'weighted_random' ? 'weighted_random' : 'sequential'
    if (!Array.isArray(p.apiKeys)) p.apiKeys = []
    p.apiKeys = p.apiKeys
      .filter((key: any) => key && typeof key === 'object')
      .map((key: any) => ({
        id: String(key.id || uid('key')).trim(),
        name: String(key.name || 'Key').trim(),
        key: String(key.key || '').trim(),
        enabled: typeof key.enabled === 'boolean' ? key.enabled : true,
        weight: Math.max(1, Math.round(Number(key.weight || 1))),
      }))
    if (!p.apiKeys.length && p.apiKey) p.apiKeys = [{ id: 'legacy', name: '默认 Key', key: p.apiKey, enabled: true, weight: 1 }]
    if (!Array.isArray(p.registeredModels)) p.registeredModels = []
    p.registeredModels = p.registeredModels
      .filter((model: any) => model && typeof model === 'object')
      .map((model: any) => normalizeReasoningFields({
        id: String(model.id || '').trim(),
        name: String(model.name || model.id || '').trim(),
        sourceModelId: String(model.sourceModelId || model.modelId || '').trim(),
        supportsReasoning: !!model.supportsReasoning,
        defaultReasoningEffort: normalizeReasoningEffort(model.defaultReasoningEffort),
      }))
      .filter((model: any) => model.id && model.sourceModelId)
    if (!p.modelsCache || typeof p.modelsCache !== 'object') p.modelsCache = { items: [], fetchedAt: 0 }
    if (!Array.isArray(p.modelsCache.items)) p.modelsCache.items = []
    p.modelsCache.fetchedAt = Number(p.modelsCache.fetchedAt || 0)
  }

  ;(d as any).favorites = normalizeFavorites((d as any).favorites)

  if (!Array.isArray(d.roles)) d.roles = []

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
    if (typeof r.modelRef.kind !== 'string') r.modelRef.kind = String(r.modelRef.groupId || '').trim() ? 'model_group' : 'provider'
    if (typeof r.modelRef.groupId !== 'string') r.modelRef.groupId = ''
    if (typeof r.modelRef.providerId !== 'string') r.modelRef.providerId = String(d.settings.providers[0]?.id || '')
    if (typeof r.modelRef.modelId !== 'string') r.modelRef.modelId = ''
    const modelKind = String(r.modelRef.kind || '').trim() === 'model_group' ? 'model_group' : 'provider'
    r.modelRef.kind = modelKind
    if (modelKind === 'provider') {
      const pid = String(r.modelRef.providerId || '')
      if (!d.settings.providers.some((p: any) => String(p?.id || '') === pid)) r.modelRef.providerId = String(d.settings.providers[0]?.id || '')
      r.modelRef.groupId = ''
    } else {
      r.modelRef.providerId = ''
    }
    r.toolPolicy = normalizeRoleToolPolicy((r as any).toolPolicy)
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
        const createdAt = normalizeTimeMs(cc.createdAt, now())
        const updatedAt = normalizeTimeMs(cc.updatedAt, createdAt)
        const messages = Array.isArray(cc.messages) ? cc.messages : []
        const hasMessageTree = hasExplicitMessageParentLinks(messages)
        const fallbackHeadMid = messages.length ? String((messages[messages.length - 1] as any)?.id || '') : ''
        const hasBranching = hasStoredBranching((cc as any).branching)
        const branching = normalizeChatBranching((cc as any).branching, fallbackHeadMid, createdAt, updatedAt)
        const activeBranchId = normalizeBranchId((branching as any).activeBranchId)
        const out: any = {
          id: cid,
          title,
          status: String((cc as any).status || '').trim(),
          createdAt,
          updatedAt,
          branching,
          messages: messages.filter((m: any) => m && typeof m === 'object').map((m: any) => normalizeChatMessage(m, { activeBranchId, toolMessagesAsAssistant: true })),
        }
		out.asyncToolTasks = normalizeAsyncToolTasks((cc as any).asyncToolTasks)
		Object.assign(out, normalizeSessionFacts(cc))

		const branches0 = Array.isArray(out.branching?.branches) ? out.branching.branches : []
        const idSet = new Set<string>()
        for (const b of branches0) {
          const id = normalizeBranchId((b as any)?.id)
          if (id) idSet.add(id)
          if (idSet.size >= 2) break
        }
        let headMid = ''
        if (idSet.size >= 2 || hasMessageTree) {
          fillMissingBranchIdsOnly(out.messages, activeBranchId)
          headMid = normalizedBranchHeadMid(out.branching?.branches, activeBranchId, out.messages, fallbackHeadMid, hasBranching)
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
        const createdAt = normalizeTimeMs(cc.createdAt, now())
        const updatedAt = normalizeTimeMs(cc.updatedAt, createdAt)
        const messages = Array.isArray(cc.messages) ? cc.messages : []
        const hasMessageTree = hasExplicitMessageParentLinks(messages)
        const fallbackHeadMid = messages.length ? String((messages[messages.length - 1] as any)?.id || '') : ''
        const hasBranching = hasStoredBranching((cc as any).branching)
        const branching = normalizeChatBranching((cc as any).branching, fallbackHeadMid, createdAt, updatedAt)
        const activeBranchId = normalizeBranchId((branching as any).activeBranchId)

		const out: any = {
			id: cid,
			title,
			status: String((cc as any).status || '').trim(),
			createdAt,
          updatedAt,
          branching,
			messages: messages.filter((m: any) => m && typeof m === 'object').map((m: any) => normalizeChatMessage(m, { activeBranchId, toolMessagesAsAssistant: false })),
		}
		out.asyncToolTasks = normalizeAsyncToolTasks((cc as any).asyncToolTasks)
		Object.assign(out, normalizeSessionFacts(cc))

		const branches0 = Array.isArray(out.branching?.branches) ? out.branching.branches : []
        const idSet = new Set<string>()
        for (const b of branches0) {
          const id = normalizeBranchId((b as any)?.id)
          if (id) idSet.add(id)
          if (idSet.size >= 2) break
        }
        let headMid = ''
        if (idSet.size >= 2 || hasMessageTree) {
          fillMissingBranchIdsOnly(out.messages, activeBranchId)
          headMid = normalizedBranchHeadMid(out.branching?.branches, activeBranchId, out.messages, fallbackHeadMid, hasBranching)
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

    const groupMetaIds = box.chatMetas.map((m: any) => String(m?.id || '')).filter(Boolean)
    if (!box.activeChatId || (!box.chats.some((c: any) => String(c.id) === box.activeChatId) && !groupMetaIds.includes(box.activeChatId))) {
      box.activeChatId = String(box.chats[0]?.id || groupMetaIds[0] || '')
    }
  }

  if (!Array.isArray((d as any).workspaces)) (d as any).workspaces = []
  ;(d as any).workspaces = (Array.isArray((d as any).workspaces) ? (d as any).workspaces : [])
    .filter((workspace: any) => workspace && typeof workspace === 'object')
    .map((workspace: any) => {
      const id = String(workspace.id || uid('w'))
      const name = typeof workspace.name === 'string' && workspace.name.trim() ? String(workspace.name || '').trim() : '未命名工作区'
      const prompt = typeof workspace.prompt === 'string' ? String(workspace.prompt || '') : ''
      const directories0 = Array.isArray(workspace.directories) ? workspace.directories : []
      const directories = directories0
        .filter((directory: any) => directory && typeof directory === 'object')
        .map((directory: any) => ({
          path: String(directory.path || '').trim(),
          alias: String(directory.alias || '').trim(),
          description: String(directory.description || '').trim(),
        }))
        .filter((directory: any) => !!directory.path)
      return {
        id,
        name,
        prompt,
        directories,
        createdAt: Number(workspace.createdAt || now()),
        updatedAt: Number(workspace.updatedAt || now()),
      }
    })

  if (!(d as any).chatsByWorkspace || typeof (d as any).chatsByWorkspace !== 'object') (d as any).chatsByWorkspace = {}
  const workspaceIds = new Set<string>((d as any).workspaces.map((workspace: any) => String(workspace?.id || '').trim()).filter(Boolean))
  const workspaceChatKeys = new Set<string>([...Object.keys((d as any).chatsByWorkspace), ...Array.from(workspaceIds)])
  for (const targetId of workspaceChatKeys) {
    const parsedTarget = parseWorkspaceRoleTargetId(targetId)
    const workspaceId = parsedTarget.workspaceId || String(targetId || '').trim()
    if (!workspaceId || !workspaceIds.has(workspaceId)) continue
    if (!(d as any).chatsByWorkspace[targetId] || typeof (d as any).chatsByWorkspace[targetId] !== 'object') (d as any).chatsByWorkspace[targetId] = { activeChatId: '', chats: [] }
    const box = (d as any).chatsByWorkspace[targetId]
    if (!Array.isArray(box.chats)) box.chats = []
    box.chatMetas = chatMetasFromBox(box, '工作区会话')
    box.activeChatId = String(box.activeChatId || '')

    box.chats = box.chats
      .filter((chat: any) => chat && typeof chat === 'object')
      .map((chat: any) => {
        const cc = chat
        const cid = String(cc.id || uid('wc'))
        const title = typeof cc.title === 'string' && cc.title.trim() ? cc.title : '工作区会话'
        const createdAt = normalizeTimeMs(cc.createdAt, now())
        const updatedAt = normalizeTimeMs(cc.updatedAt, createdAt)
        const messages = Array.isArray(cc.messages) ? cc.messages : []
        const hasMessageTree = hasExplicitMessageParentLinks(messages)
        const fallbackHeadMid = messages.length ? String((messages[messages.length - 1] as any)?.id || '') : ''
        const hasBranching = hasStoredBranching((cc as any).branching)
        const branching = normalizeChatBranching((cc as any).branching, fallbackHeadMid, createdAt, updatedAt)
        const activeBranchId = normalizeBranchId((branching as any).activeBranchId)
		const out: any = {
          id: cid,
          roleId: String((cc as any).roleId || '').trim(),
          workspaceId,
          title,
          status: String((cc as any).status || '').trim(),
          createdAt,
          updatedAt,
          branching,
          messages: messages.filter((message: any) => message && typeof message === 'object').map((message: any) => normalizeChatMessage(message, { activeBranchId, toolMessagesAsAssistant: true })),
        }
		out.asyncToolTasks = normalizeAsyncToolTasks((cc as any).asyncToolTasks)
		Object.assign(out, normalizeSessionFacts(cc))

		const branches0 = Array.isArray(out.branching?.branches) ? out.branching.branches : []
        const idSet = new Set<string>()
        for (const b of branches0) {
          const id = normalizeBranchId((b as any)?.id)
          if (id) idSet.add(id)
          if (idSet.size >= 2) break
        }
        let headMid = ''
        if (idSet.size >= 2 || hasMessageTree) {
          fillMissingBranchIdsOnly(out.messages, activeBranchId)
          headMid = normalizedBranchHeadMid(out.branching?.branches, activeBranchId, out.messages, fallbackHeadMid, hasBranching)
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

    const workspaceMetaIds = box.chatMetas.map((meta: any) => String(meta?.id || '')).filter(Boolean)
    if (!box.activeChatId || (!box.chats.some((chat: any) => String(chat.id) === box.activeChatId) && !workspaceMetaIds.includes(box.activeChatId))) {
      box.activeChatId = String(box.chats[0]?.id || workspaceMetaIds[0] || '')
    }
  }

  const targetKind0 = String((d.ui as any).activeTargetKind || '').trim()
  const targetKind = targetKind0 === 'group' ? 'group' : targetKind0 === 'workspace' ? 'workspace' : 'role'
  ;(d.ui as any).activeTargetKind = targetKind

  const activeRoleId = String(d.ui.activeRoleId || '')
  if (!activeRoleId || !d.roles.some((r: any) => String(r?.id) === activeRoleId)) d.ui.activeRoleId = String(d.roles[0]?.id || '')

  const activeGroupId = String((d.ui as any).activeGroupId || '').trim()
  if (activeGroupId && !(d as any).groups.some((g: any) => String(g?.id || '') === activeGroupId)) (d.ui as any).activeGroupId = ''

  const activeWorkspaceId = String((d.ui as any).activeWorkspaceId || '').trim()
  if (activeWorkspaceId && !(d as any).workspaces.some((workspace: any) => String(workspace?.id || '') === activeWorkspaceId)) (d.ui as any).activeWorkspaceId = ''

  const hasGroups = !!((d as any).groups && (d as any).groups.length)
  const hasWorkspaces = !!((d as any).workspaces && (d as any).workspaces.length)
  if (targetKind === 'group' && !hasGroups) (d.ui as any).activeTargetKind = 'role'
  if (targetKind === 'workspace' && !hasWorkspaces) (d.ui as any).activeTargetKind = hasGroups ? 'group' : 'role'

  return d
}
