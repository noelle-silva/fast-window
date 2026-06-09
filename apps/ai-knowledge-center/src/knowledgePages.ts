import type { CollectionSummary, DocumentStatus } from './types'

export type KnowledgePage = 'all' | 'collections' | 'archive' | 'trash'
export type AppPage = KnowledgePage | 'settings'

export const KNOWLEDGE_PAGES: Array<{ value: KnowledgePage; label: string }> = [
  { value: 'collections', label: '收藏夹' },
  { value: 'trash', label: '回收站' },
  { value: 'archive', label: '归档' },
  { value: 'all', label: '全部笔记' },
]

export const DOCUMENT_PAGE_TEXT: Record<Exclude<KnowledgePage, 'collections'>, { title: string; eyebrow: string; empty: string }> = {
  all: { title: '全部笔记', eyebrow: 'All Notes', empty: '暂无匹配笔记' },
  archive: { title: '归档', eyebrow: 'Archive', empty: '暂无归档笔记' },
  trash: { title: '回收站', eyebrow: 'Trash', empty: '回收站暂无笔记' },
}

const STATUS_LABELS: Record<DocumentStatus, string> = {
  active: '活跃',
  archived: '归档',
  trashed: '回收站',
  all: '全部',
}

export function isKnowledgePage(page: AppPage): page is KnowledgePage {
  return page !== 'settings'
}

export function documentStatusForPage(page: KnowledgePage): DocumentStatus {
  if (page === 'archive') return 'archived'
  if (page === 'trash') return 'trashed'
  return 'all'
}

export function statusLabel(status: string) {
  return STATUS_LABELS[status as DocumentStatus] || status
}

export function displayTime(value?: string) {
  if (!value) return '无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

export function joinTags(tags: string[]) {
  return tags.length ? tags.join(' / ') : '无标签'
}

export function rootCollections(collections: CollectionSummary[]) {
  const childIDs = new Set(collections.flatMap(collection => collection.child_collection_ids))
  const roots = collections.filter(collection => !childIDs.has(collection.id))
  return roots.length ? roots : collections
}

export function collectionChildren(collection: CollectionSummary, collections: CollectionSummary[]) {
  const byID = new Map(collections.map(item => [item.id, item]))
  return collection.child_collection_ids
    .map(id => byID.get(id))
    .filter((item): item is CollectionSummary => Boolean(item))
}
