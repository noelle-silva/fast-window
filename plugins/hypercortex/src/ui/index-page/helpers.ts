import type { HyperCortexFavoritesDocV1, FavoriteItemRef } from '../../favorites'
import type { DeleteEntityTarget } from './types'
import { getFolderById } from '../../favorites'
import { normalizeLayout } from '../index-layout'
import { INDEX_GRID_COLUMNS } from './constants'

export function folderTitle(doc: HyperCortexFavoritesDocV1, folderId: string): string {
  const id = String(folderId || '').trim() || 'root'
  if (id === 'root') return '收藏夹'
  return getFolderById(doc, id)?.title || '未命名文件夹'
}

export function getRefGridSpan(ref: FavoriteItemRef): { gridColumn: string; gridRow: string } {
  const layout = normalizeLayout({ id: ref.id, ...ref.layout }, INDEX_GRID_COLUMNS)
  return {
    gridColumn: `${layout.x + 1} / span ${layout.w}`,
    gridRow: `${layout.y + 1} / span ${layout.h}`,
  }
}

export function folderDeleteHelperText(folderId: string): string {
  if (folderId === 'root') return '根收藏夹是系统入口，不能删除。'
  return '这是 delete entity，会删除收藏夹本体，并清理所有页面里对它的引用。'
}

export function entityDeleteHelperText(kind: DeleteEntityTarget['kind']): string {
  if (kind === 'folder') return '这是 delete entity，不是 remove ref。删除后，所有页面中指向这个收藏夹的卡片都会被清理。'
  if (kind === 'note') return '这是 delete entity，不是 remove ref。删除后，现有页面中的相关卡片会变成失效引用卡片。'
  return '这是 delete entity，不是 remove ref。删除后，现有页面中的相关卡片会变成失效引用卡片。'
}
