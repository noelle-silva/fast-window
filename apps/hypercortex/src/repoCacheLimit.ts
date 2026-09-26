// 仓库现场常驻上限：打开过的仓库各保留一份常驻现场，超过上限回收最久未使用的。
// 设置面板、应用设置归一化、外壳回收共用同一解析，保证事实源唯一。

export const DEFAULT_REPO_CACHE_LIMIT = 20
export const MIN_REPO_CACHE_LIMIT = 1
export const MAX_REPO_CACHE_LIMIT = 100

export function normalizeRepoCacheLimit(value: unknown): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_REPO_CACHE_LIMIT
  if (n < MIN_REPO_CACHE_LIMIT) return MIN_REPO_CACHE_LIMIT
  if (n > MAX_REPO_CACHE_LIMIT) return MAX_REPO_CACHE_LIMIT
  return n
}
