import type { AiChatBackendCapabilities } from '../gateway/capabilities'
import { readBackendDataDirs } from '../storage/backendDataDirs'
import { createNodeFileStorageAdapter } from '../storage/nodeFileStorageAdapter'
import { createNodeImageStorageAdapter } from '../storage/nodeImageStorageAdapter'

export function createBackendHostCapabilities(): AiChatBackendCapabilities {
  const dirs = readBackendDataDirs()
  const { persistent, runtime } = createNodeFileStorageAdapter(dirs)
  const images = createNodeImageStorageAdapter(dirs.dataDir)

  return {
    meta: { pluginId: dirs.pluginId, runtime: 'background' },
    storage: {
      get: (key) => persistent.get(key),
      set: (key, value) => persistent.set(key, value),
      remove: (key) => persistent.remove(key),
    },
    runtimeStorage: {
      get: (key) => runtime.get(key),
      set: (key, value) => runtime.set(key, value),
      remove: (key) => runtime.remove(key),
      listDir: (key) => runtime.listDir(key),
      flush: runtime.flush,
    },
    net: {
      request: async (req: unknown) => {
        const r = req as any
        const url = String(r?.url || '')
        const method = String(r?.method || 'GET').toUpperCase()
        const headers: Record<string, string> = {}
        if (r?.headers && typeof r.headers === 'object') {
          for (const [k, v] of Object.entries(r.headers as Record<string, unknown>)) {
            if (typeof v === 'string') headers[k] = v
          }
        }
        const body = r?.body != null ? String(r.body) : undefined
        const timeoutMs = Number(r?.timeoutMs || 120000)

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
          const resp = await fetch(url, { method, headers, body, signal: controller.signal })
          const respBody = await resp.text()
          return { status: resp.status, body: respBody }
        } finally {
          clearTimeout(timer)
        }
      },
      requestStream: undefined, // stream to be implemented in phase 4
    },
    files: {
      images: {
        writeBase64: (req: unknown) => images.writeBase64(req),
        read: (req: unknown) => images.read(req),
        delete: (req: unknown) => images.delete(req),
      },
    },
  }
}
