import type { InstallSourceStatus, ReleaseSource, ReleaseSourceProvider, SourceOutcome } from '../domain/release'

// createInstallSourceClient 按发布物类别读写安装来源与来源注册表；
// 工具与插件各有一份独立配置，接口按类别参数化。
export function createInstallSourceClient(deps: {
  netRequest: (req: any) => Promise<any>
}) {
  async function get(kind: string): Promise<InstallSourceStatus | null> {
    try {
      const response = await deps.netRequest({ method: 'GET', path: `/api/install-source/${encodeURIComponent(kind)}` })
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
      const response = await deps.netRequest({ method: 'PUT', path: `/api/install-source/${encodeURIComponent(kind)}`, body: { source } })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error || '切换商店来源失败') }
    }
  }

  async function listSources(kind: string): Promise<{ sources: ReleaseSource[]; problem: string } | null> {
    try {
      const response = await deps.netRequest({ method: 'GET', path: `/api/sources/${encodeURIComponent(kind)}` })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return { sources: readSources(response?.body), problem: String(response?.body?.problem || '').trim() }
    } catch {
      return null
    }
  }

  async function addSource(kind: string, source: ReleaseSource): Promise<SourceOutcome> {
    return sourcesRequest(kind, 'POST', {
      name: source.name,
      kind: source.kind,
      path: source.path,
      indexUrl: source.indexUrl,
    })
  }

  async function updateSource(
    kind: string,
    name: string,
    patch: { newName?: string; newKind?: ReleaseSourceProvider; newPath?: string; newIndexUrl?: string },
  ): Promise<SourceOutcome> {
    const body: Record<string, unknown> = { name }
    if (patch.newName !== undefined) body.newName = patch.newName
    if (patch.newKind !== undefined) body.newKind = patch.newKind
    if (patch.newPath !== undefined) body.newPath = patch.newPath
    if (patch.newIndexUrl !== undefined) body.newIndexUrl = patch.newIndexUrl
    return sourcesRequest(kind, 'PATCH', body)
  }

  async function removeSource(kind: string, name: string): Promise<SourceOutcome> {
    return sourcesRequest(kind, 'DELETE', { name })
  }

  async function sourcesRequest(kind: string, method: string, body: Record<string, unknown>): Promise<SourceOutcome> {
    try {
      const response = await deps.netRequest({ method, path: `/api/sources/${encodeURIComponent(kind)}`, body })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return { ok: true, sources: readSources(response?.body) }
    } catch (error: any) {
      return { ok: false, sources: [], error: String(error?.message || error || '商店来源操作失败') }
    }
  }

  return { get, set, listSources, addSource, updateSource, removeSource }
}

function readSources(body: any): ReleaseSource[] {
  const raw = body && typeof body === 'object' ? (body as any).sources : null
  if (!Array.isArray(raw)) return []
  return raw
    .map((item: any) => {
      const kind: ReleaseSourceProvider = String(item?.kind || '').trim() === 'remote' ? 'remote' : 'shelf'
      return {
        name: String(item?.name || '').trim(),
        kind,
        path: String(item?.path || '').trim() || undefined,
        indexUrl: String(item?.indexUrl || '').trim() || undefined,
      }
    })
    .filter((item: ReleaseSource) => item.name !== '')
}
