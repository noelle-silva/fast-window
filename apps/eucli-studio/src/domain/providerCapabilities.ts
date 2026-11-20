// 协议与思考档位的词汇表归业务端（eucli-box）所有：
// 客户端不复制枚举、不猜别名，只把 GET /api/capabilities 的清单整理成下拉选项。
//
// 这里守三条边界，与 modelGroupStrategies 完全一致：
// 1. 只做「丢空值 / 去重 / 修剪空白」，value 一律原样保留 —— 业务端新增的协议
//    或档位在客户端不认识也必须能存回来，不能被改写成任何别的值；
// 2. 客户端不发明展示名：label 缺席时退回 value 本身；
// 3. 兜底只发生在渲染层 —— 清单拿不到时只显示已保存的那个值，绝不编造选项。
//
// 这份清单同时承载协议与思考档位：两者结构相同，都由业务端声明取值域。

export type CapabilityOption = {
  value: string
  label: string
  description: string
}

// ProviderCapabilities 是 GET /api/capabilities 的归一形态。
export type ProviderCapabilities = {
  protocols: CapabilityOption[]
  reasoningEfforts: CapabilityOption[]
}

const EMPTY_CAPABILITIES: ProviderCapabilities = { protocols: [], reasoningEfforts: [] }

// normalizeCapabilityOptions 接受接口的原始清单（也接受已整理过的清单，重复调用结果不变）。
export function normalizeCapabilityOptions(raw: unknown): CapabilityOption[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const options: CapabilityOption[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const value = String(record.value ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    const label = String(record.label ?? '').trim()
    options.push({ value, label: label || value, description: String(record.description ?? '').trim() })
  }
  return options
}

// normalizeProviderCapabilities 把接口响应归一为两份下拉清单。
export function normalizeProviderCapabilities(raw: unknown): ProviderCapabilities {
  const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!item) return EMPTY_CAPABILITIES
  return {
    protocols: normalizeCapabilityOptions(item.protocols),
    reasoningEfforts: normalizeCapabilityOptions(item.reasoningEfforts),
  }
}

// resolveCapabilitySelection 是下拉渲染的唯一入口。
//
// 已保存的值原样进、原样出：清单里没有它（清单失败 / 为空 / 业务端刚加了新取值）时
// 就把它当成唯一可见的选项挂上去，只显示不清洗 —— 这样用户不会看到空白下拉，
// 但也绝不会被客户端编造的选项误导。
export function resolveCapabilitySelection(
  options: CapabilityOption[],
  currentValue: unknown,
): { value: string; label: string; description: string; options: CapabilityOption[] } {
  const saved = String(currentValue ?? '').trim()
  // 只有真的没有已保存值时才取清单第一项：业务端给出的顺序就是默认顺序。
  const value = saved || String(options[0]?.value || '')
  if (!value) return { value: '', label: '', description: '', options: [] }
  const matched = options.find((option) => option.value === value)
  if (matched) return { ...matched, options }
  const current: CapabilityOption = { value, label: value, description: '' }
  return { ...current, options: options.length ? [...options, current] : [current] }
}
