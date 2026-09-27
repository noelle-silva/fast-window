import * as React from 'react'
import type { AiChatAppRuntime } from './aiChatAppHost'
import { createReleaseStore, type ReleaseStoreRuntime } from './releaseStore'
import { composeReleaseCandidatesView, type ReleaseCandidatesViews } from '../domain/release'

// useReleaseStore 是发行 store 核心的 React 适配层：
// 核心负责编排与缓存（可独立验证），本层只做订阅与视图组合。
export function useReleaseStore(getRuntime: () => AiChatAppRuntime | null, showToast: (message: unknown, options?: { kind?: 'success' | 'error' | 'info' }) => void) {
  const getRuntimeRef = React.useRef(getRuntime)
  getRuntimeRef.current = getRuntime
  const toastRef = React.useRef(showToast)
  toastRef.current = showToast

  const storeRef = React.useRef<ReturnType<typeof createReleaseStore> | null>(null)
  if (!storeRef.current) {
    storeRef.current = createReleaseStore(createRuntimeBridge(() => getRuntimeRef.current()), (message) => toastRef.current(message, { kind: 'error' }))
  }
  const store = storeRef.current
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)

  const views = React.useMemo<ReleaseCandidatesViews>(() => {
    const checking = state.busy
    const installations = state.installations
    return {
      tool: composeReleaseCandidatesView(state.cache, 'tool', { source: state.sources.tool || 'official', checking, installations }),
      plugin: composeReleaseCandidatesView(state.cache, 'plugin', { source: state.sources.plugin || 'official', checking, installations }),
    }
  }, [state])

  return { views, busy: state.busy, read: store.read, refresh: store.refresh }
}

// createRuntimeBridge 把客户端运行时收敛为核心需要的最小能力；运行时未就绪时返回 null。
function createRuntimeBridge(getRuntime: () => AiChatAppRuntime | null): () => ReleaseStoreRuntime | null {
  return () => {
    const runtime = getRuntime()
    if (!runtime) return null
    return {
      resolveSource: async (kind) => {
        const status = await runtime.controller?.actions?.getInstallSource?.(kind)
        const source = typeof status?.source === 'string' ? status.source.trim() : ''
        // 来源配置不可用时不解析来源：商店读取会从业务端拿到失败事实。
        if (!source) return null
        const shelfView = await Promise.resolve()
          .then(() => runtime.controller?.actions?.getShelves?.(kind))
          .catch(() => null)
        const shelfList = shelfView && Array.isArray(shelfView.shelves) ? shelfView.shelves : null
        return {
          source,
          shelves: shelfList ? shelfList.map((item: any) => String(item?.name || '')).filter(Boolean) : null,
        }
      },
      listInstallations: async () => (await runtime.listArtifactInstallations()).artifacts,
      listCandidates: (kind) => runtime.listReleaseCandidates(kind),
    }
  }
}
