import { id, trimSlash } from './utils'

export const AI_DRAW_VERSION = 1
export const PROMPT_LIBRARY_VERSION = 1
export const DEFAULT_PROMPT_HISTORY_LIMIT = 50
export const MAX_PROMPT_HISTORY_LIMIT = 200
export const DEFAULT_REQUEST_TIMEOUT_SEC = 120
export const MIN_REQUEST_TIMEOUT_SEC = 5
export const MAX_REQUEST_TIMEOUT_SEC = 3600

export const UI_MODE_NORMAL = 'normal' as const
export const UI_MODE_LOCAL_EDIT = 'local-edit' as const
export type UiMode = typeof UI_MODE_NORMAL | typeof UI_MODE_LOCAL_EDIT

export type AiDrawProvider = {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  protocol: 'images' | 'chat'
  models: string[]
  model: string
  customModel: string
  size: string
  chatSystemPrompt: string
}

export type AiDrawSettingsV1 = {
  version: number
  autoSave: boolean
  shrinkRefImages: boolean
  uiMode: UiMode
  promptHistoryLimit: number
  requestTimeoutSec: number
  promptHistory: string[]
  pendingTaskId: string
  activeProviderId: string
  providers: AiDrawProvider[]
}

export type PromptLibraryPrompt = { id: string; text: string; at: number }
export type PromptLibraryFolder = { id: string; name: string; prompts: PromptLibraryPrompt[] }
export type PromptLibraryV1 = { version: number; activeFolderId: string; folders: PromptLibraryFolder[] }

export function defaultProvider(): AiDrawProvider {
  return {
    id: id('prov'),
    name: '默认供应商',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    protocol: 'images',
    models: ['gpt-image-1'],
    model: 'gpt-image-1',
    customModel: '',
    size: '1024x1024',
    chatSystemPrompt: '',
  }
}

export function defaultSettings(): AiDrawSettingsV1 {
  const p = defaultProvider()
  return {
    version: AI_DRAW_VERSION,
    autoSave: true,
    shrinkRefImages: true,
    uiMode: UI_MODE_NORMAL,
    promptHistoryLimit: DEFAULT_PROMPT_HISTORY_LIMIT,
    requestTimeoutSec: DEFAULT_REQUEST_TIMEOUT_SEC,
    promptHistory: [],
    pendingTaskId: '',
    activeProviderId: p.id,
    providers: [p],
  }
}

export function normalizePromptHistoryLimit(raw: any) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_PROMPT_HISTORY_LIMIT
  const v = Math.floor(n)
  if (v < 1) return 1
  if (v > MAX_PROMPT_HISTORY_LIMIT) return MAX_PROMPT_HISTORY_LIMIT
  return v
}

export function normalizeRequestTimeoutSec(raw: any) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_REQUEST_TIMEOUT_SEC
  const v = Math.floor(n)
  if (v < MIN_REQUEST_TIMEOUT_SEC) return MIN_REQUEST_TIMEOUT_SEC
  if (v > MAX_REQUEST_TIMEOUT_SEC) return MAX_REQUEST_TIMEOUT_SEC
  return v
}

export function normalizePromptHistory(list: any, limitRaw: any) {
  const limit = normalizePromptHistoryLimit(limitRaw)
  const raw = Array.isArray(list) ? list : []
  const out: string[] = []
  for (const item of raw) {
    const text = String(item || '').trim()
    if (!text) continue
    const existed = out.indexOf(text)
    if (existed >= 0) out.splice(existed, 1)
    out.push(text)
    if (out.length > limit) out.shift()
  }
  return out
}

export function normalizeModels(list: any) {
  const raw = Array.isArray(list) ? list : []
  const out: string[] = []
  for (const x of raw) {
    const s = String(x || '').trim()
    if (!s) continue
    if (!out.includes(s)) out.push(s)
    if (out.length >= 200) break
  }
  return out
}

export function normalizeProvider(p: any): AiDrawProvider {
  const out: any = p && typeof p === 'object' ? p : {}
  out.id = String(out.id || id('prov'))
  out.name = String(out.name || '供应商')
  out.baseUrl = trimSlash(String(out.baseUrl || 'https://api.openai.com/v1'))
  out.apiKey = String(out.apiKey || '')
  out.protocol = String(out.protocol || 'images') === 'chat' ? 'chat' : 'images'
  out.models = normalizeModels(out.models)
  out.model = String(out.model || out.models[0] || '')
  out.customModel = String(out.customModel || '')
  out.size = String(out.size || '1024x1024')
  out.chatSystemPrompt = typeof out.chatSystemPrompt === 'string' ? out.chatSystemPrompt : ''

  // 保持 UI 一致性：如果 models 列表不包含当前选择，则回退到第一个；若为空则切到自定义。
  const pick = String(out.model || '').trim()
  if (out.models.length) {
    if (pick && pick !== '__custom__' && out.models.includes(pick)) {
      // ok
    } else if (pick === '__custom__') {
      // ok
    } else {
      out.model = out.models[0]
    }
  } else {
    if (!pick) out.model = '__custom__'
  }
  return out as AiDrawProvider
}

export function normalizeUiMode(raw: any): UiMode {
  const v = String(raw || '').trim()
  return v === UI_MODE_LOCAL_EDIT ? UI_MODE_LOCAL_EDIT : UI_MODE_NORMAL
}

function migrateLegacySettingsToSettingsV1(s: any): AiDrawSettingsV1 {
  const p = defaultProvider()
  p.name = String(s?.providerName || p.name)
  p.baseUrl = trimSlash(String(s?.baseUrl || p.baseUrl))
  p.apiKey = String(s?.apiKey || '')
  p.protocol = String(s?.protocol || 'images') === 'chat' ? 'chat' : 'images'
  p.size = String(s?.size || p.size)
  p.chatSystemPrompt = typeof s?.chatSystemPrompt === 'string' ? s.chatSystemPrompt : ''
  const m = String(s?.model || '').trim()
  if (m) {
    p.models = normalizeModels([m])
    p.model = m
  }
  const out = defaultSettings()
  out.providers = [p]
  out.activeProviderId = p.id
  out.autoSave = typeof s?.autoSave === 'boolean' ? s.autoSave : true
  out.shrinkRefImages = true
  out.uiMode = UI_MODE_NORMAL
  out.promptHistoryLimit = normalizePromptHistoryLimit(s?.promptHistoryLimit)
  out.requestTimeoutSec = normalizeRequestTimeoutSec(s?.requestTimeoutSec)
  out.promptHistory = normalizePromptHistory(s?.promptHistory, out.promptHistoryLimit)
  return out
}

export function normalizeSettings(raw: any): AiDrawSettingsV1 {
  if (!raw || typeof raw !== 'object') return defaultSettings()

  if (!Array.isArray((raw as any).providers)) {
    return migrateLegacySettingsToSettingsV1(raw)
  }

  const d: any = raw
  const out = defaultSettings()
  out.version = AI_DRAW_VERSION
  out.autoSave = typeof d.autoSave === 'boolean' ? d.autoSave : true
  out.shrinkRefImages = typeof d.shrinkRefImages === 'boolean' ? d.shrinkRefImages : true
  out.uiMode = normalizeUiMode(d.uiMode)
  out.promptHistoryLimit = normalizePromptHistoryLimit(d.promptHistoryLimit)
  out.requestTimeoutSec = normalizeRequestTimeoutSec(d.requestTimeoutSec)
  out.promptHistory = normalizePromptHistory(d.promptHistory, out.promptHistoryLimit)
  out.pendingTaskId = String(d.pendingTaskId || '').trim()

  out.providers = Array.isArray(d.providers) ? d.providers.map(normalizeProvider) : defaultSettings().providers
  if (!out.providers.length) out.providers = defaultSettings().providers

  const pid = String(d.activeProviderId || '')
  out.activeProviderId = out.providers.some((x) => x.id === pid) ? pid : out.providers[0].id
  return out
}

export function defaultPromptLibrary(): PromptLibraryV1 {
  const f: PromptLibraryFolder = { id: id('plf'), name: '默认收藏夹', prompts: [] }
  return { version: PROMPT_LIBRARY_VERSION, activeFolderId: f.id, folders: [f] }
}

export function normalizePromptLibrary(raw: any): PromptLibraryV1 {
  if (!raw || typeof raw !== 'object') return defaultPromptLibrary()
  const v: any = raw
  const out = defaultPromptLibrary()
  out.version = PROMPT_LIBRARY_VERSION

  const folders = Array.isArray(v.folders) ? v.folders : []
  out.folders = folders
    .map((f: any) => {
      const fid = String(f?.id || '').trim() || id('plf')
      const name = String(f?.name || '').trim() || '未命名收藏夹'
      const prompts = Array.isArray(f?.prompts) ? f.prompts : []
      const normPrompts = prompts
        .map((p: any) => {
          const pid = String(p?.id || '').trim() || id('plp')
          const text = String(p?.text || '').trim()
          const at = Number(p?.at)
          const stamp = Number.isFinite(at) && at > 0 ? at : Date.now()
          return { id: pid, text, at: stamp }
        })
        .filter((x: any) => !!x && !!String(x.text || '').trim())
      return { id: fid, name, prompts: normPrompts }
    })
    .filter((x: any) => !!x && !!String(x.id || '').trim())

  if (!out.folders.length) out.folders = defaultPromptLibrary().folders
  const activeFolderId = String(v.activeFolderId || '').trim()
  out.activeFolderId = out.folders.some((f) => f.id === activeFolderId) ? activeFolderId : out.folders[0].id
  return out
}

export function resolveModel(p: AiDrawProvider | null): string {
  if (!p) return ''
  const pick = String(p.model || '').trim()
  if (pick === '__custom__') return String(p.customModel || '').trim()
  return pick
}
