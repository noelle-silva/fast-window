import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { getRefsByFolderId } from '../favorites'
import { assetTabId } from '../assetTypes'
import { noteTabKey } from '../tabKey'
import { buildAssetLookup, resolveAssetRef, type AssetLookup } from '../assetLookup'

// 收藏夹导航栏条目的「详情标签键」模型：把一条收藏引用映射为全局统一的详情目标键。
// 左侧标签栏与右侧收藏夹栏由此共用同一套目标标识，快捷键切换与选中高亮才能对齐。

type FavoriteEntry = {
  tabKey: string
  ref: FavoriteItemRef
}

/** 一页收藏夹的完整视图：附件查找表、原始引用与可切换的详情条目，一次组装，多处消费。 */
export type FavoriteFolderView = {
  lookup: AssetLookup
  refs: FavoriteItemRef[]
  entries: FavoriteEntry[]
}

/** 把一条收藏引用映射为详情标签键；文件夹与失效条目返回空串（不参与详情选中）。 */
function favoriteRefTabKey(ref: FavoriteItemRef, lookup: AssetLookup): string {
  if (ref.kind === 'note') return noteTabKey(ref.targetId)
  if (ref.kind === 'asset') {
    const asset = resolveAssetRef(lookup, ref.targetId)
    return asset ? assetTabId(asset) : ''
  }
  return ''
}

/** 组装一页收藏夹视图：取当前页引用、建附件查找表，并映射为可切换的详情条目。 */
export function buildFavoriteFolderView(input: {
  doc: HyperCortexFavoritesDocV1 | null
  folderId: string
  assetIndex?: Record<string, any>
}): FavoriteFolderView {
  const lookup = buildAssetLookup(input.assetIndex)
  const refs = input.doc ? getRefsByFolderId(input.doc, input.folderId) : []
  const entries: FavoriteEntry[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const tabKey = favoriteRefTabKey(ref, lookup)
    if (!tabKey || seen.has(tabKey)) continue
    seen.add(tabKey)
    entries.push({ tabKey, ref })
  }
  return { lookup, refs, entries }
}

/** 判断一条收藏引用是否命中当前激活的详情目标。 */
export function isFavoriteRefActive(ref: FavoriteItemRef, activeTabKey: string, lookup: AssetLookup): boolean {
  const key = favoriteRefTabKey(ref, lookup)
  return !!key && key === String(activeTabKey || '').trim()
}

/**
 * 关闭当前激活条目后，在当前收藏夹页按原位置选下一个续接目标：
 * 先沿下方找下一条、再沿上方找上一条，跳过同批被关闭的条目；只认笔记与附件（entries 已过滤）。
 * 当前条目不在本页时返回空串，交由上层走既有回退。
 */
export function nextFavoriteEntryAfterClose(
  entries: readonly { tabKey: string }[],
  currentTabKey: string,
  closing: ReadonlySet<string>,
): string {
  const current = String(currentTabKey || '').trim()
  if (!current) return ''
  const idx = entries.findIndex(entry => entry.tabKey === current)
  if (idx < 0) return ''
  const candidates = [...entries.slice(idx + 1), ...entries.slice(0, idx).reverse()]
  return candidates.find(entry => !closing.has(entry.tabKey))?.tabKey || ''
}
