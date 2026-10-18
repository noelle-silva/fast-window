type NetRequest = (req: any) => Promise<any>

export type EntityOrderCollection =
  | 'roles'
  | 'workspaces'
  | 'providers'
  | 'tools'
  | 'system-plugins'
  | 'sticker-categories'
  | 'placeholders'

const orderPaths: Record<EntityOrderCollection, string> = {
  roles: '/api/roles/order',
  workspaces: '/api/workspaces/order',
  providers: '/api/providers/order',
  tools: '/api/tools/order',
  'system-plugins': '/api/system-plugins/order',
  'sticker-categories': '/api/stickers/categories/order',
  placeholders: '/api/placeholders/order',
}

// 同一集合的排序写入串行化：快速连续拖拽时，后发的完整顺序不会先于前一条到达业务端。
const writeChains = new Map<EntityOrderCollection, Promise<void>>()

export function saveEntityOrder(
  netRequest: NetRequest,
  collection: EntityOrderCollection,
  ids: string[],
): Promise<void> {
  const normalized = ids.map((id) => String(id || '').trim()).filter(Boolean)
  if (!normalized.length) return Promise.resolve()
  const previous = writeChains.get(collection) || Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await netRequest({
        method: 'PUT',
        path: orderPaths[collection],
        body: { ids: normalized },
        timeoutMs: 15000,
      })
    })
  writeChains.set(collection, next)
  const release = () => {
    if (writeChains.get(collection) === next) writeChains.delete(collection)
  }
  void next.then(release, release)
  return next
}
