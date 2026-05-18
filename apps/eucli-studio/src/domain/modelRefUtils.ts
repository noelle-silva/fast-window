export function normalizeChatModelOverride(chat: unknown): { providerId: string; modelId: string } | null {
  const c = chat && typeof chat === 'object' ? (chat as Record<string, unknown>) : null
  const o = c && c.modelOverride && typeof c.modelOverride === 'object' ? (c.modelOverride as Record<string, unknown>) : null
  const providerId = String(o?.providerId || '').trim()
  const modelId = String(o?.modelId || '').trim()
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

export function normalizeMessageModelRef(message: unknown): { providerId: string; modelId: string } | null {
  const m = message && typeof message === 'object' ? (message as Record<string, unknown>) : null
  const r = m && (m as any).modelRef && typeof (m as any).modelRef === 'object' ? (m as any).modelRef as Record<string, unknown> : null
  const providerId = String(r?.providerId || '').trim()
  const modelId = String(r?.modelId || '').trim()
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

export function buildMessageModelRef(providerId: unknown, modelId: unknown): { providerId: string; modelId: string } | null {
  const pid = String(providerId || '').trim()
  const mid = String(modelId || '').trim()
  if (!pid || !mid) return null
  return { providerId: pid, modelId: mid }
}

export function resolveProviderDisplayName(providers: unknown, providerId: unknown): string {
  const pid = String(providerId || '').trim()
  if (!pid) return ''
  const list = Array.isArray(providers) ? providers : []
  const provider = list.find((item: any) => String(item?.id || '').trim() === pid)
  return String((provider as any)?.name || '').trim()
}

export function formatModelRefDisplayText(modelRef: unknown, providers: unknown): string {
  const ref = modelRef && typeof modelRef === 'object' ? (modelRef as Record<string, unknown>) : null
  const providerText = resolveProviderDisplayName(providers, ref?.providerId)
  const modelId = String(ref?.modelId || '').trim()
  if (!providerText && !modelId) return ''
  return providerText && modelId ? `${providerText} / ${modelId}` : providerText || modelId
}
