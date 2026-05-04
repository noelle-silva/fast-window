import { type GridLayout } from '../favorites'

const DEFAULT_MAX_COLS = 12

export type GridRect = GridLayout & { id: string }

export function isOverlapping(a: GridRect, b: GridRect): boolean {
  const ax1 = a.x
  const ay1 = a.y
  const ax2 = a.x + a.w
  const ay2 = a.y + a.h

  const bx1 = b.x
  const by1 = b.y
  const bx2 = b.x + b.w
  const by2 = b.y + b.h

  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1
}

export function findCollisions(rects: GridRect[], target: GridRect): GridRect[] {
  return rects.filter(r => r.id !== target.id && isOverlapping(r, target))
}

export function findEmptySlot(
  rects: GridRect[],
  w: number,
  h: number,
  maxCols: number = DEFAULT_MAX_COLS,
): { x: number; y: number } | null {
  const cols = Number.isFinite(maxCols) ? Math.max(1, Math.floor(maxCols)) : DEFAULT_MAX_COLS
  const ww = Number.isFinite(w) ? Math.max(1, Math.floor(w)) : 1
  const hh = Number.isFinite(h) ? Math.max(1, Math.floor(h)) : 1

  if (ww > cols) return null

  const maxBottom = rects.reduce((m, r) => Math.max(m, (r.y || 0) + (r.h || 0)), 0)
  const maxX = cols - ww

  for (let y = 0; y <= maxBottom; y++) {
    for (let x = 0; x <= maxX; x++) {
      const candidate: GridRect = { id: '__candidate__', x, y, w: ww, h: hh }
      if (!rects.some(r => isOverlapping(r, candidate))) return { x, y }
    }
  }

  return { x: 0, y: maxBottom }
}

export function normalizeLayout(rect: GridRect, maxCols: number = DEFAULT_MAX_COLS): GridRect {
  const cols = Number.isFinite(maxCols) ? Math.max(1, Math.floor(maxCols)) : DEFAULT_MAX_COLS

  let x = Number.isFinite(rect.x) ? Math.max(0, Math.floor(rect.x)) : 0
  let y = Number.isFinite(rect.y) ? Math.max(0, Math.floor(rect.y)) : 0
  let w = Number.isFinite(rect.w) ? Math.max(1, Math.floor(rect.w)) : 1
  const h = Number.isFinite(rect.h) ? Math.max(1, Math.floor(rect.h)) : 1

  if (x >= cols) x = cols - 1

  if (x + w > cols) {
    w = Math.max(1, cols - x)
  }

  return { ...rect, x, y, w, h }
}

function compareByYx(a: GridRect, b: GridRect): number {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)
}

export function resolveCollisions(rects: GridRect[], movedId: string, maxCols: number = DEFAULT_MAX_COLS): GridRect[] {
  const cols = Number.isFinite(maxCols) ? Math.max(1, Math.floor(maxCols)) : DEFAULT_MAX_COLS

  const normalized = rects.map(r => normalizeLayout(r, cols))
  const moved = normalized.find(r => r.id === movedId)

  const others = normalized.filter(r => r.id !== movedId).sort(compareByYx)

  const placed: GridRect[] = []
  if (moved) placed.push(moved)

  for (const rect of others) {
    let next = rect

    while (true) {
      let maxBottom = next.y
      let hasCollision = false

      for (const p of placed) {
        if (!isOverlapping(p, next)) continue
        hasCollision = true
        maxBottom = Math.max(maxBottom, p.y + p.h)
      }

      if (!hasCollision) break
      next = { ...next, y: maxBottom }
    }

    placed.push(next)
  }

  const byId = new Map<string, GridRect>()
  for (const r of placed) byId.set(r.id, r)

  return rects.map(r => byId.get(r.id) ?? normalizeLayout(r, cols))
}

