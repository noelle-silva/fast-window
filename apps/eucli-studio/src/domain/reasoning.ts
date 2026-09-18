export type ReasoningEffort = 'very_low' | 'low' | 'medium' | 'high' | 'very_high'

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium'

export const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'very_low', label: '极低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'very_high', label: '极高' },
]

const REASONING_EFFORT_VALUES = new Set(REASONING_EFFORT_OPTIONS.map((option) => option.value))

export type ReasoningProfile = {
  supportsReasoning: boolean
  defaultReasoningEffort: ReasoningEffort | ''
}

export function normalizeReasoningEffort(value: unknown, fallback: ReasoningEffort | '' = ''): ReasoningEffort | '' {
  const effort = String(value || '').trim() as ReasoningEffort
  if (REASONING_EFFORT_VALUES.has(effort)) return effort
  return fallback
}

export function reasoningEffortLabel(value: unknown) {
  const effort = normalizeReasoningEffort(value)
  return REASONING_EFFORT_OPTIONS.find((option) => option.value === effort)?.label || ''
}

export function normalizeReasoningProfile(value: unknown): ReasoningProfile {
  const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  const supportsReasoning = !!item?.supportsReasoning
  if (!supportsReasoning) return { supportsReasoning: false, defaultReasoningEffort: '' }
  return {
    supportsReasoning: true,
    defaultReasoningEffort: normalizeReasoningEffort(item?.defaultReasoningEffort, DEFAULT_REASONING_EFFORT),
  }
}

export function normalizeReasoningFields<T extends Record<string, unknown>>(value: T): T {
  const supportsReasoning = !!value.supportsReasoning
  if (!supportsReasoning) {
    const out = { ...value }
    delete out.supportsReasoning
    delete out.defaultReasoningEffort
    return out
  }
  return {
    ...value,
    supportsReasoning: true,
    defaultReasoningEffort: normalizeReasoningEffort(value.defaultReasoningEffort, DEFAULT_REASONING_EFFORT),
  }
}

export function chatReasoningEffort(chat: unknown): ReasoningEffort | '' {
  const c = chat && typeof chat === 'object' ? (chat as Record<string, unknown>) : null
  return normalizeReasoningEffort(c?.reasoningEffort)
}

export function effectiveReasoningEffort(chat: unknown, profile: ReasoningProfile): ReasoningEffort | '' {
  if (!profile.supportsReasoning) return ''
  return chatReasoningEffort(chat) || profile.defaultReasoningEffort || DEFAULT_REASONING_EFFORT
}

export function modelReasoningProfileFromModelRef(modelRef: unknown, providers: unknown, modelGroups: unknown): ReasoningProfile {
  const ref = modelRef && typeof modelRef === 'object' ? (modelRef as Record<string, unknown>) : null
  const kind = String(ref?.kind || '').trim() === 'model_group' || String(ref?.groupId || '').trim() ? 'model_group' : 'provider'
  const modelId = String(ref?.modelId || '').trim()
  if (!modelId) return { supportsReasoning: false, defaultReasoningEffort: '' }

  if (kind === 'model_group') {
    const groupId = String(ref?.groupId || '').trim()
    const groups = Array.isArray(modelGroups) ? modelGroups : []
    const group = groups.find((item: any) => String(item?.id || '').trim() === groupId) || null
    const models = Array.isArray((group as any)?.models) ? (group as any).models : []
    const model = models.find((item: any) => String(item?.id || '').trim() === modelId) || null
    return normalizeReasoningProfile(model)
  }

  const providerId = String(ref?.providerId || '').trim()
  const list = Array.isArray(providers) ? providers : []
  const provider = list.find((item: any) => String(item?.id || '').trim() === providerId) || null
  const registeredModels = Array.isArray((provider as any)?.registeredModels) ? (provider as any).registeredModels : []
  const model = registeredModels.find((item: any) => String(item?.id || '').trim() === modelId) || null
  return normalizeReasoningProfile(model)
}
