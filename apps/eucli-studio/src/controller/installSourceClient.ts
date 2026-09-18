export function createInstallSourceClient(deps: {
  netRequest: (req: any) => Promise<any>
}) {
  async function get(): Promise<string | null> {
    try {
      const response = await deps.netRequest({ method: 'GET', path: '/api/install-source', timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const kind = String(response?.body?.kind || '')
      return kind === 'official' || kind === 'local' ? kind : null
    } catch {
      return null
    }
  }

  async function set(kindRaw: 'official' | 'local'): Promise<{ ok: boolean; error?: string }> {
    const kind = kindRaw === 'local' ? 'local' : 'official'
    try {
      const response = await deps.netRequest({ method: 'PUT', path: '/api/install-source', body: { kind }, timeoutMs: 15000 })
      const status = Number(response?.status || 0)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error || '切换商店源失败') }
    }
  }

  return { get, set }
}
