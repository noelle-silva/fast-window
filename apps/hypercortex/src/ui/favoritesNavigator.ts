import type { HyperCortexFavoritesNavV1 } from '../core'

// 收藏夹导航栏的浏览历史：纯逻辑，不依赖 React 与收藏夹文档实体。
// 位置以收藏夹标识序列表达：back 为来路（栈底最早），forward 为回程。

export const FAVORITES_NAV_ROOT = 'root'
const MAX_HISTORY = 128

export function createFavoritesNav(): HyperCortexFavoritesNavV1 {
  return { currentFolderId: FAVORITES_NAV_ROOT, back: [], forward: [] }
}

function normalizeFolderId(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeStack(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const id = normalizeFolderId(item)
    if (!id || out.includes(id)) continue
    out.push(id)
    if (out.length >= MAX_HISTORY) break
  }
  return out
}

export function normalizeFavoritesNav(raw: unknown): HyperCortexFavoritesNavV1 {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any) : null
  if (!rec) return createFavoritesNav()
  const currentFolderId = normalizeFolderId(rec.currentFolderId) || FAVORITES_NAV_ROOT
  return {
    currentFolderId,
    back: normalizeStack(rec.back),
    forward: normalizeStack(rec.forward),
  }
}

/**
 * 从根收藏夹到当前收藏夹的导航连线（祖先链）。
 * 侧边栏逐层进入收藏夹时，来路栈天然记录了这条链：
 * - 当前不在来路：链为「来路 + 当前」；
 * - 当前已在来路：说明经文件夹引用回跳到了祖先，链截断到该祖先。
 * 结果保证根在最前，供顶部路径下拉直接消费。
 */
export function favoritesNavTrail(state: HyperCortexFavoritesNavV1): string[] {
  const current = normalizeFolderId(state.currentFolderId) || FAVORITES_NAV_ROOT
  const back = state.back.map(normalizeFolderId).filter(Boolean)
  const at = back.lastIndexOf(current)
  const chain = at >= 0 ? back.slice(0, at + 1) : [...back, current]
  if (chain[0] !== FAVORITES_NAV_ROOT) chain.unshift(FAVORITES_NAV_ROOT)
  return chain
}

/** 下钻到目标收藏夹：当前位置压入来路，回程清空。目标与当前相同则不产生变化。 */
export function navigateFavoritesNav(state: HyperCortexFavoritesNavV1, folderId: string): HyperCortexFavoritesNavV1 {
  const target = normalizeFolderId(folderId)
  if (!target || target === state.currentFolderId) return state
  const back = [...state.back, state.currentFolderId]
  if (back.length > MAX_HISTORY) back.splice(0, back.length - MAX_HISTORY)
  return { currentFolderId: target, back, forward: [] }
}

/** 后退：回到来路上最近一处；没有来路时原样返回。 */
export function goBackFavoritesNav(state: HyperCortexFavoritesNavV1): HyperCortexFavoritesNavV1 {
  if (!state.back.length) return state
  const back = state.back.slice()
  const previous = back.pop() as string
  const forward = [...state.forward, state.currentFolderId]
  if (forward.length > MAX_HISTORY) forward.splice(0, forward.length - MAX_HISTORY)
  return { currentFolderId: previous, back, forward }
}

/** 前进：回到回程上最近一处；没有回程时原样返回。 */
export function goForwardFavoritesNav(state: HyperCortexFavoritesNavV1): HyperCortexFavoritesNavV1 {
  if (!state.forward.length) return state
  const forward = state.forward.slice()
  const next = forward.pop() as string
  const back = [...state.back, state.currentFolderId]
  if (back.length > MAX_HISTORY) back.splice(0, back.length - MAX_HISTORY)
  return { currentFolderId: next, back, forward }
}

/**
 * 与现存收藏夹集合调和：当前位置失效则回到根收藏夹并清空历史；
 * 历史中失效的收藏夹条目一并剔除，保证前进/后退不会落到已不存在的层。
 */
export function reconcileFavoritesNav(state: HyperCortexFavoritesNavV1, existingFolderIds: ReadonlySet<string>): HyperCortexFavoritesNavV1 {
  const exists = (id: string) => id === FAVORITES_NAV_ROOT || existingFolderIds.has(id)
  const back = state.back.filter(exists)
  const forward = state.forward.filter(exists)
  if (!exists(state.currentFolderId)) {
    return { currentFolderId: FAVORITES_NAV_ROOT, back, forward }
  }
  if (back.length === state.back.length && forward.length === state.forward.length) return state
  return { ...state, back, forward }
}
