// 收藏夹层级导航：纯逻辑，不依赖 React 与实体类型。
// 照搬 hypercortex 的收藏夹导航模型（favoritesNavigator），只保留「下钻 + 返回」两条路径：
// 会话收藏夹侧边栏直接进入下一层，返回按钮沿来路回退。

export type FavoriteFolderNav = {
  currentFolderId: string
  /** 来路栈：栈底最早，栈顶是上一层。 */
  back: string[]
}

export const FAVORITE_FOLDER_ROOT = ''
const MAX_HISTORY = 128

export function createFavoriteFolderNav(): FavoriteFolderNav {
  return { currentFolderId: FAVORITE_FOLDER_ROOT, back: [] }
}

function normalizeFolderId(value: unknown) {
  return String(value ?? '').trim()
}

export function normalizeFavoriteFolderNav(raw: unknown): FavoriteFolderNav {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any) : null
  if (!rec) return createFavoriteFolderNav()
  const back: string[] = []
  for (const item of Array.isArray(rec.back) ? rec.back : []) {
    const id = normalizeFolderId(item)
    if (!id || back.includes(id)) continue
    back.push(id)
    if (back.length >= MAX_HISTORY) break
  }
  return {
    currentFolderId: normalizeFolderId(rec.currentFolderId) || FAVORITE_FOLDER_ROOT,
    back,
  }
}

/** 下钻到目标收藏夹：当前层压入来路。目标与当前相同则不产生变化。 */
export function navigateFavoriteFolder(state: FavoriteFolderNav, folderId: string): FavoriteFolderNav {
  const target = normalizeFolderId(folderId)
  if (target === state.currentFolderId) return state
  const back = [...state.back, state.currentFolderId]
  if (back.length > MAX_HISTORY) back.splice(0, back.length - MAX_HISTORY)
  return { currentFolderId: target, back }
}

/** 返回上一层：没有来路时原样返回。 */
export function goBackFavoriteFolder(state: FavoriteFolderNav): FavoriteFolderNav {
  if (!state.back.length) return state
  const back = state.back.slice()
  const previous = back.pop() as string
  return { currentFolderId: previous, back }
}

/**
 * 与现存收藏夹集合调和：当前层失效则回到根并清空来路；
 * 来路里失效的层剔除，避免返回落到已不存在的收藏夹。
 */
export function reconcileFavoriteFolderNav(state: FavoriteFolderNav, existingFolderIds: ReadonlySet<string>): FavoriteFolderNav {
  const exists = (id: string) => id === FAVORITE_FOLDER_ROOT || existingFolderIds.has(id)
  const back = state.back.filter(exists)
  // 当前层没了就回根，来路一并清空：原来的来路已经和这棵树断开，留着只会把返回带到无关的层。
  if (!exists(state.currentFolderId)) return { currentFolderId: FAVORITE_FOLDER_ROOT, back: [] }
  if (back.length === state.back.length) return state
  return { currentFolderId: state.currentFolderId, back }
}
