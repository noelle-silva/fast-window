export type ChatSaveIntent = {
  deletedMessageIds?: string[]
  deletedSubtreeRootIds?: string[]
  deletedMessageParentById?: Record<string, string>
}

function normalizeIdList(raw: any) {
  const list = Array.isArray(raw) ? raw : raw instanceof Set ? Array.from(raw) : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const id = String(item || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function normalizeParentMap(raw: any) {
  const out: Record<string, string> = {}
  const box = raw && typeof raw === 'object' ? raw : {}
  for (const [idRaw, parentRaw] of Object.entries(box)) {
    const id = String(idRaw || '').trim()
    if (!id) continue
    out[id] = String(parentRaw || '').trim()
  }
  return out
}

export function normalizeChatSaveIntent(raw: any): ChatSaveIntent {
  return {
    deletedMessageIds: normalizeIdList(raw?.deletedMessageIds),
    deletedSubtreeRootIds: normalizeIdList(raw?.deletedSubtreeRootIds),
    deletedMessageParentById: normalizeParentMap(raw?.deletedMessageParentById),
  }
}

export function createDeletedMessagesSaveIntent(
  deletedIds: Iterable<unknown>,
  deletedMessageParentById?: Record<string, unknown>,
  subtreeRootIds?: Iterable<unknown>,
): ChatSaveIntent {
  return normalizeChatSaveIntent({
    deletedMessageIds: Array.from(deletedIds || []),
    deletedSubtreeRootIds: Array.from(subtreeRootIds || []),
    deletedMessageParentById: deletedMessageParentById || {},
  })
}
