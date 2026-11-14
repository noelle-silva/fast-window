// 模型组策略的词汇表归业务端所有：客户端不复制枚举、不猜别名，
// 只把 GET /api/model-groups/strategies 的清单整理成下拉选项。
//
// 这里守两条边界：
// 1. 落地只做「丢空值 / 去重 / 修剪空白」，value 一律原样保留 —— 业务端新增的策略
//    在客户端不认识也必须能存回来，不能被改写成任何别的值；
// 2. 兜底只发生在渲染层 —— 清单拿不到时只显示模型上已保存的那个值，绝不编造选项。

export type ModelGroupStrategyOption = {
  value: string
  label: string
  description: string
}

// ModelGroupStrategySelection 是下拉的完整输入：选中项 + 可选项，一次算完交给渲染层。
export type ModelGroupStrategySelection = ModelGroupStrategyOption & {
  options: ModelGroupStrategyOption[]
}

const EMPTY_SELECTION: ModelGroupStrategySelection = { value: '', label: '', description: '', options: [] }

// 接受接口的原始清单（也接受已经整理过的清单，重复调用结果不变）。
export function normalizeModelGroupStrategyOptions(raw: unknown): ModelGroupStrategyOption[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const options: ModelGroupStrategyOption[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const value = String(record.value ?? '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    // label 缺席时退回策略值本身：展示名只能来自业务端，客户端不发明名字。
    const label = String(record.label ?? '').trim()
    options.push({ value, label: label || value, description: String(record.description ?? '').trim() })
  }
  return options
}

// resolveModelGroupStrategySelection 是策略渲染的唯一入口。
//
// 已保存的值原样进、原样出：清单里没有它（清单失败 / 为空 / 业务端刚加了新策略）时
// 就把它当成唯一可见的选项挂上去，只显示不清洗。
export function resolveModelGroupStrategySelection(rawStrategies: unknown, currentValue: unknown): ModelGroupStrategySelection {
  const options = normalizeModelGroupStrategyOptions(rawStrategies)
  const saved = String(currentValue ?? '').trim()
  // 只有真的没有已保存值时才取清单第一项：业务端给出的顺序就是默认顺序。
  const value = saved || String(options[0]?.value || '')
  if (!value) return EMPTY_SELECTION
  const matched = options.find((option) => option.value === value)
  if (matched) return { ...matched, options }
  // 已保存但清单里没有：保留全部可选项（用户仍能换成有效值），并把当前值原样列出来。
  const current: ModelGroupStrategyOption = { value, label: value, description: '' }
  return { ...current, options: options.length ? [...options, current] : [current] }
}
