import * as React from 'react'
import type { AiChatAppRuntime } from './aiChatAppHost'
import { createReleaseStore, type ReleaseStoreRuntime } from './releaseStore'
import { composeReleaseCandidatesView, RELEASE_ARTIFACT_KINDS } from '../domain/release'

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

  const view = React.useMemo(() => composeReleaseCandidatesView(state.cache, state.source, {
    kinds: RELEASE_ARTIFACT_KINDS,
    checking: state.busy,
    installations: state.installations,
  }), [state])

  return { view, busy: state.busy, read: store.read, refresh: store.refresh }
}

// createRuntimeBridge 把客户端运行时收敛为核心需要的最小能力；运行时未就绪时返回 null。
function createRuntimeBridge(getRuntime: () => AiChatAppRuntime | null): () => ReleaseStoreRuntime | null {
  return () => {
    const runtime = getRuntime()
    if (!runtime) return null
    return {
      resolveSource: async () => {
        const resolved = await runtime.controller?.actions?.getInstallSource?.()
        return resolved === 'official' || resolved === 'local' ? resolved : null
      },
      listInstallations: async () => (await runtime.listArtifactInstallations()).artifacts,
      listCandidates: (kind) => runtime.listReleaseCandidates(kind),
    }
  }
}
