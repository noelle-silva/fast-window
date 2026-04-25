import type { FavoriteItemRef, GridLayout, HyperCortexFavoritesDocV1 } from '../../favorites'
import { updateRefLayout } from '../../favorites'
import { normalizeLayout, resolveCollisions, type GridRect } from '../index-layout'
import { INDEX_GRID_COLUMNS, INDEX_GRID_MAX_H, INDEX_GRID_MIN_H, INDEX_GRID_MIN_W } from './constants'

function toRect(ref: FavoriteItemRef): GridRect {
  return normalizeLayout({ id: ref.id, ...ref.layout }, INDEX_GRID_COLUMNS)
}

function toLayoutMap(refs: FavoriteItemRef[]): Map<string, GridLayout> {
  const out = new Map<string, GridLayout>()
  for (const ref of refs) {
    const rect = toRect(ref)
    out.set(ref.id, { x: rect.x, y: rect.y, w: rect.w, h: rect.h })
  }
  return out
}

function clampResize(layout: GridLayout): GridLayout {
  const normalized = normalizeLayout({ id: '__draft__', ...layout }, INDEX_GRID_COLUMNS)
  return {
    x: normalized.x,
    y: normalized.y,
    w: Math.max(INDEX_GRID_MIN_W, normalized.w),
    h: Math.min(INDEX_GRID_MAX_H, Math.max(INDEX_GRID_MIN_H, normalized.h)),
  }
}

export function buildResolvedLayoutMap(
  refs: FavoriteItemRef[],
  movedId: string,
  patch: Partial<GridLayout>,
): Map<string, GridLayout> {
  const rects = refs.map(ref => {
    if (ref.id !== movedId) return toRect(ref)
    const next = clampResize({ ...ref.layout, ...patch })
    return normalizeLayout({ id: ref.id, ...next }, INDEX_GRID_COLUMNS)
  })

  const resolved = resolveCollisions(rects, movedId, INDEX_GRID_COLUMNS)
  const out = new Map<string, GridLayout>()
  for (const rect of resolved) {
    out.set(rect.id, { x: rect.x, y: rect.y, w: rect.w, h: rect.h })
  }
  return out
}

export function applyLayoutMapToDoc(doc: HyperCortexFavoritesDocV1, refs: FavoriteItemRef[], layoutMap: Map<string, GridLayout>): HyperCortexFavoritesDocV1 {
  let nextDoc = doc
  for (const ref of refs) {
    const nextLayout = layoutMap.get(ref.id)
    if (!nextLayout) continue
    const current = normalizeLayout({ id: ref.id, ...ref.layout }, INDEX_GRID_COLUMNS)
    const normalizedNext = normalizeLayout({ id: ref.id, ...nextLayout }, INDEX_GRID_COLUMNS)
    if (current.x === normalizedNext.x && current.y === normalizedNext.y && current.w === normalizedNext.w && current.h === normalizedNext.h) continue
    nextDoc = updateRefLayout(nextDoc, ref.id, { x: normalizedNext.x, y: normalizedNext.y, w: normalizedNext.w, h: normalizedNext.h })
  }
  return nextDoc
}

export function buildBaseLayoutMap(refs: FavoriteItemRef[]): Map<string, GridLayout> {
  return toLayoutMap(refs)
}
