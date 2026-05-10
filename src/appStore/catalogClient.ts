import { parseStoreCatalog } from './catalogSchema'
import type { StoreCatalog } from './catalogTypes'

export async function fetchStoreCatalog(url: string, timeoutMs: number, signal?: AbortSignal): Promise<StoreCatalog> {
  const catalogUrl = String(url || '').trim()
  if (!catalogUrl) throw new Error('catalog url is empty')

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = window.setTimeout(() => ctrl.abort(), Math.max(1_000, timeoutMs))
  try {
    const resp = await fetch(catalogUrl, { cache: 'no-store', signal: ctrl.signal })
    if (!resp.ok) throw new Error(`failed to fetch store catalog: HTTP ${resp.status}`)
    return parseStoreCatalog(await resp.json())
  } finally {
    signal?.removeEventListener('abort', onAbort)
    window.clearTimeout(timer)
  }
}
