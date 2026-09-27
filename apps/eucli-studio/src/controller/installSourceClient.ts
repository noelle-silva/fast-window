import type { InstallSourceStatus, Shelf, ShelfOutcome } from '../domain/release'

export function createInstallSourceClient(deps: {
  netRequest: (req: any) => Promise<any>
}) {
  async function get(): Promise<InstallSourceStatus | null> {
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/install-source', timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return {
        source: String(response?.body?.source || '').trim(),
        problem: String(response?.body?.problem || '').trim(),
      }
    } catch {
      return null
    }
  }

  async function set(sourceRaw: string): Promise<{ ok: boolean; error?: string }> {
    const source = String(sourceRaw || '').trim()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: '/api/install-source', body: { source }, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error || '切换商店来源失败') }
    }
  }

  async function listShelves(): Promise<{ shelves: Shelf[]; problem: string } | null> {
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/shelves', timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return { shelves: readShelves(response?.body), problem: String(response?.body?.problem || '').trim() }
    } catch {
      return null
    }
  }

  async function addShelf(name: string, path: string): Promise<ShelfOutcome> {
    return shelvesRequest('POST', { name, path })
  }

  async function updateShelf(name: string, newName?: string, newPath?: string): Promise<ShelfOutcome> {
    const body: Record<string, unknown> = { name }
    if (newName !== undefined) body.newName = newName
    if (newPath !== undefined) body.newPath = newPath
    return shelvesRequest('PATCH', body)
  }

  async function removeShelf(name: string): Promise<ShelfOutcome> {
    return shelvesRequest('DELETE', { name })
  }

  async function shelvesRequest(method: string, body: Record<string, unknown>): Promise<ShelfOutcome> {
    try {
      const response = await deps.netRequest({ method, path: '/api/shelves', body, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return { ok: true, shelves: readShelves(response?.body) }
    } catch (error: any) {
      return { ok: false, shelves: [], error: String(error?.message || error || '货架操作失败') }
    }
  }

  return { get, set, listShelves, addShelf, updateShelf, removeShelf }
}

function readShelves(body: any): Shelf[] {
  const raw = body && typeof body === 'object' ? (body as any).shelves : null
  if (!Array.isArray(raw)) return []
  return raw
    .map((item: any) => ({ name: String(item?.name || '').trim(), path: String(item?.path || '').trim() }))
    .filter((item: Shelf) => item.name !== '')
}
