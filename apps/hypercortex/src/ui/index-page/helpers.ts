import type { HyperCortexFavoritesDocV1, FavoriteItemRef, GridLayout } from '../../favorites'
import type { DeleteEntityTarget } from './types'
import { getFolderById } from '../../favorites'
import { normalizeLayout } from '../index-layout'
import { INDEX_GRID_COLUMNS, INDEX_GRID_GAP_PX, INDEX_GRID_ROW_PX } from './constants'

export function folderTitle(doc: HyperCortexFavoritesDocV1, folderId: string): string {
  const id = String(folderId || '').trim() || 'root'
  if (id === 'root') return '根目录'
  return getFolderById(doc, id)?.title || '未命名文件夹'
}

export function getRefGridSpan(ref: FavoriteItemRef): { gridColumn: string; gridRow: string } {
  const layout = normalizeLayout({ id: ref.id, ...ref.layout }, INDEX_GRID_COLUMNS)
  return {
    gridColumn: `${layout.x + 1} / span ${layout.w}`,
    gridRow: `${layout.y + 1} / span ${layout.h}`,
  }
}

export function getRefFrame(layout: GridLayout, gridWidth: number): { width: number; height: number } {
  const totalGap = INDEX_GRID_GAP_PX * (INDEX_GRID_COLUMNS - 1)
  const colWidth = Math.max(0, (gridWidth - totalGap) / INDEX_GRID_COLUMNS)
  return {
    width: Math.max(0, layout.w * colWidth + Math.max(0, layout.w - 1) * INDEX_GRID_GAP_PX),
    height: Math.max(0, layout.h * INDEX_GRID_ROW_PX + Math.max(0, layout.h - 1) * INDEX_GRID_GAP_PX),
  }
}

export function getRefPixelRect(layout: GridLayout, gridWidth: number): { left: number; top: number; width: number; height: number } {
  const totalGap = INDEX_GRID_GAP_PX * (INDEX_GRID_COLUMNS - 1)
  const colWidth = Math.max(0, (gridWidth - totalGap) / INDEX_GRID_COLUMNS)
  const stepX = colWidth + INDEX_GRID_GAP_PX
  const stepY = INDEX_GRID_ROW_PX + INDEX_GRID_GAP_PX
  const frame = getRefFrame(layout, gridWidth)
  return {
    left: Math.max(0, layout.x * stepX),
    top: Math.max(0, layout.y * stepY),
    width: frame.width,
    height: frame.height,
  }
}

export function folderDeleteHelperText(folderId: string): string {
  if (folderId === 'root') return '根目录是系统入口，不能删除。'
  return '会删除这个收藏夹本体，并把别处指向它的所有引用一并删除；开启回收站时可在回收站恢复。'
}

export function entityDeleteHelperText(kind: DeleteEntityTarget['kind']): string {
  if (kind === 'folder') return '会删除这个收藏夹本体，并把别处指向它的所有引用一并删除；开启回收站时可在回收站恢复。'
  if (kind === 'note') return '会删除这条笔记，并把它在收藏夹里的所有引用一并删除；开启回收站时可在回收站恢复。'
  return '会删除这个附件，并把它在收藏夹里的所有引用一并删除；开启回收站时可恢复。'
}
