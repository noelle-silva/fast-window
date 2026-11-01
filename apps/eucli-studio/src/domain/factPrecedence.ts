// 事实源优先级唯一声明。
//
// 本模块只回答一个最小问题：当同一事实出现多个来源时，谁的优先级更高。
// 它不负责判断某个值是否「真实存在」「是否过期」「是否只能前进」——
// 这些属于每种事实自己的规则，统一放在各事实的 resolve*Fact 中。
//
// 声明（高 → 低）：
//   user-intent       用户明确意图：点击切换、发送、编辑、显式删除
//   runtime-transient 运行期临时态：流式增量、活动运行卡、未落盘消息
//   server-fact       服务端权威事实：落盘快照、索引快照、终态事件
//   local-projection  本地投影：缓存、列表顺序、UI 兜底值
//
// 注意：这里的顺序是「默认来源顺序」。某个事实若存在更强的时间约束
// （例如分支头只能前进），必须在该事实的规则函数里显式写出例外，
// 不允许调用点再各自写 if。

export const FACT_SOURCES = ['user-intent', 'runtime-transient', 'server-fact', 'local-projection'] as const

export type FactSource = (typeof FACT_SOURCES)[number]

export const FACT_SOURCE_RANK: Record<FactSource, number> = {
  'user-intent': 4,
  'runtime-transient': 3,
  'server-fact': 2,
  'local-projection': 1,
}

export function factSourceRank(source: FactSource): number {
  return FACT_SOURCE_RANK[source] || 0
}

export type FactCandidate<T> = {
  source: FactSource
  value: T
}

// pickFactCandidate 在「可用」的候选里取来源等级最高者。
//
// 同等级时先到者胜出（显式规则，不是隐式 Array.sort 稳定性）：
// 调用方需要「后到者胜」时必须把后到者排在前面，或在其事实规则里
// 明确表达时间/版本约束。
export function pickFactCandidate<T>(
  candidates: readonly FactCandidate<T>[],
  isUsable: (value: T) => boolean = () => true,
): FactCandidate<T> | null {
  let best: FactCandidate<T> | null = null
  for (const candidate of candidates) {
    if (!isUsable(candidate.value)) continue
    if (!best || factSourceRank(candidate.source) > factSourceRank(best.source)) best = candidate
  }
  return best
}
