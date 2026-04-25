import type { HyperCortexFavoritesDocV1 } from './favorites'

export type FolderRefIssue = 'missing-source' | 'missing-target' | 'self-reference' | 'cycle'

function normalizeFolderId(folderId: string): string {
  return String(folderId || '').trim()
}

function getReferencedFolderIds(doc: HyperCortexFavoritesDocV1, folderId: string): string[] {
  const fid = normalizeFolderId(folderId)
  if (!fid) return []
  const refs = Array.isArray(doc.refsByFolderId?.[fid]) ? doc.refsByFolderId[fid] : []
  const out: string[] = []
  for (const ref of refs) {
    if (!ref || ref.kind !== 'folder') continue
    const targetId = normalizeFolderId(ref.targetId)
    if (!targetId) continue
    out.push(targetId)
  }
  return out
}

export function canReachFolder(doc: HyperCortexFavoritesDocV1, fromFolderId: string, targetFolderId: string): boolean {
  const fromId = normalizeFolderId(fromFolderId)
  const targetId = normalizeFolderId(targetFolderId)
  if (!fromId || !targetId) return false
  if (fromId === targetId) return true

  const queue = [fromId]
  const visited = new Set<string>()

  while (queue.length) {
    const current = queue.shift() || ''
    if (!current || visited.has(current)) continue
    visited.add(current)

    for (const nextId of getReferencedFolderIds(doc, current)) {
      if (nextId === targetId) return true
      if (!visited.has(nextId)) queue.push(nextId)
    }
  }

  return false
}

export function getFolderRefIssue(doc: HyperCortexFavoritesDocV1, sourceFolderId: string, targetFolderId: string): FolderRefIssue | null {
  const sourceId = normalizeFolderId(sourceFolderId)
  const targetId = normalizeFolderId(targetFolderId)
  if (!sourceId || !doc.folders[sourceId]) return 'missing-source'
  if (!targetId || !doc.folders[targetId]) return 'missing-target'
  if (sourceId === targetId) return 'self-reference'
  if (canReachFolder(doc, targetId, sourceId)) return 'cycle'
  return null
}

export function wouldCreateFolderReferenceCycle(doc: HyperCortexFavoritesDocV1, sourceFolderId: string, targetFolderId: string): boolean {
  const issue = getFolderRefIssue(doc, sourceFolderId, targetFolderId)
  return issue === 'self-reference' || issue === 'cycle'
}
