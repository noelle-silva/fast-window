import type { InstallSourceStatus, Shelf, ShelfOutcome } from '../domain/release'

// createInstallSourceClient 按发布物类别读写安装来源与货架注册表；
// 工具与插件各有一份独立配置，接口按类别参数化。
export function createInstallSourceClient(deps: {
  netRequest: (req: any) => Promise<any>
}) {
  async function get(kind: string): Promise<InstallSourceStatus | null> {
    try {
      const response = await deps.netRequest({ method: 'GET', path: `/api/install-source/${encodeURIComponent(kind)}`, timeoutMs: 15000 })
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

  async function set(kind: string, sourceRaw: string): Promise<{ ok: boolean; error?: string }> {
    const source = String(sourceRaw || '').trim()
    try {
      const response = await deps.netRequest({ method: 'PUT', path: `/api/install-source/${encodeURIComponent(kind)}`, body: { source }, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error || '切换商店来源失败') }
    }
  }

  async function listShelves(kind: string): Promise<{ shelves: Shelf[]; problem: string } | null> {
    try {
      const response = await deps.netRequest({ method: 'GET', path: `/api/shelves/${encodeURIComponent(kind)}`, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return { shelves: readShelves(response?.body), problem: String(response?.body?.problem || '').trim() }
    } catch {
      return null
    }
  }

  async function addShelf(kind: string, name: string, path: string): Promise<ShelfOutcome> {
    return shelvesRequest(kind, 'POST', { name, path })
  }

  async function updateShelf(kind: string, name: string, newName?: string, newPath?: string): Promise<ShelfOutcome> {
    const body: Record<string, unknown> = { name }
    if (newName !== undefined) body.newName = newName
    if (newPath !== undefined) body.newPath = newPath
    return shelvesRequest(kind, 'PATCH', body)
  }

  async function removeShelf(kind: string, name: string): Promise<ShelfOutcome> {
    return shelvesRequest(kind, 'DELETE', { name })
  }

  async function shelvesRequest(kind: string, method: string, body: Record<string, unknown>): Promise<ShelfOutcome> {
    try {
      const response = await deps.netRequest({ method, path: `/api/shelves/${encodeURIComponent(kind)}`, body, timeoutMs: 15000 })
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
