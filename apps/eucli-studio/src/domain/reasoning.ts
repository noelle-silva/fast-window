// 思考档位在客户端没有词汇表。
//
// 取值域由业务端通过 GET /api/capabilities 声明，下拉选项也由它渲染（见
// domain/providerCapabilities）。本模块只做两件事：
// 原样承载实体上已保存的取值，以及用业务端清单查展示名。
//
// 客户端不校验、不翻译、不降级：非法值由业务端快速失败，那正是它该做的。
// 客户端自己维护一份词表只会制造第二个事实源，两边必然漂移。

export type ReasoningEffort = string

export type ReasoningProfile = {
  supportsReasoning: boolean
  defaultReasoningEffort: ReasoningEffort
}

function trimEffort(value: unknown): ReasoningEffort {
  return String(value ?? '').trim()
}

// normalizeReasoningEffort 只修剪空白，不判断合法性。
export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return trimEffort(value)
}

// reasoningEffortLabel 用业务端清单查展示名；清单里没有就原样回显取值，
// 这样业务端新增档位时客户端不认识也能正确显示。
export function reasoningEffortLabel(value: unknown, options: Array<{ value: string; label: string }>): string {
  const effort = trimEffort(value)
  if (!effort) return ''
  const matched = options.find((option) => String(option?.value ?? '').trim() === effort)
  return String(matched?.label ?? '').trim() || effort
}

export function normalizeReasoningProfile(value: unknown): ReasoningProfile {
  const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (!item?.supportsReasoning) return { supportsReasoning: false, defaultReasoningEffort: '' }
  return { supportsReasoning: true, defaultReasoningEffort: trimEffort(item.defaultReasoningEffort) }
}

// normalizeReasoningFields 在模型不支持推理时摘掉推理字段，
// 支持时原样承载业务端给的默认档位。
export function normalizeReasoningFields<T extends Record<string, unknown>>(value: T): T {
  if (!value.supportsReasoning) {
    const out = { ...value }
    delete out.supportsReasoning
    delete out.defaultReasoningEffort
    return out
  }
  return {
    ...value,
    supportsReasoning: true,
    defaultReasoningEffort: trimEffort(value.defaultReasoningEffort),
  }
}

export function chatReasoningEffort(chat: unknown): ReasoningEffort {
  const c = chat && typeof chat === 'object' ? (chat as Record<string, unknown>) : null
  return trimEffort(c?.reasoningEffort)
}

// effectiveReasoningEffort 回答"这次实际用哪个档位"：会话覆盖优先，其次模型默认。
// 两者都没有就是空——客户端不发明默认档位，由业务端按自己的默认行为处理。
export function effectiveReasoningEffort(chat: unknown, profile: ReasoningProfile): ReasoningEffort {
  if (!profile.supportsReasoning) return ''
  return chatReasoningEffort(chat) || profile.defaultReasoningEffort
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
