import {
  emptyReleaseCache,
  releaseKindsToLoad,
  RELEASE_ARTIFACT_KINDS,
  writeReleaseCache,
  type ArtifactCandidateList,
  type ArtifactInstallation,
  type ReleaseArtifactKind,
  type ReleaseCache,
  type ReleaseSourceKind,
} from '../domain/release'

// ReleaseStoreRuntime 是核心执行一次读取所需的最小外部能力；来源解析失败返回 null。
export type ReleaseStoreRuntime = {
  resolveSource: () => Promise<ReleaseSourceKind | null>
  listInstallations: () => Promise<ArtifactInstallation[]>
  listCandidates: (kind: ReleaseArtifactKind) => Promise<ArtifactCandidateList>
}

export type ReleaseStoreSnapshot = {
  cache: ReleaseCache
  source: ReleaseSourceKind
  installations: ArtifactInstallation[]
  busy: boolean
}

export type ReleaseStore = {
  getSnapshot: () => ReleaseStoreSnapshot
  subscribe: (listener: () => void) => () => void
  read: (kind?: string) => Promise<void>
  refresh: (kind?: string) => Promise<void>
}

function emptyReleaseStoreSnapshot(): ReleaseStoreSnapshot {
  return { cache: emptyReleaseCache(), source: 'official', installations: [], busy: false }
}

// createReleaseStore 是发行数据的唯一编排与缓存核心（不依赖 React）：
// 按「来源 × 分类」缓存，新鲜缓存复用，读取失败保留旧缓存并记录失败原因。
export function createReleaseStore(getRuntime: () => ReleaseStoreRuntime | null, onError: (message: string) => void): ReleaseStore {
  let snapshot = emptyReleaseStoreSnapshot()
  const listeners = new Set<() => void>()

  function update(mutator: (current: ReleaseStoreSnapshot) => ReleaseStoreSnapshot) {
    const next = mutator(snapshot)
    if (sameSnapshot(snapshot, next)) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  async function load(kinds: ReleaseArtifactKind[], force: boolean) {
    const runtime = getRuntime()
    if (!runtime) return
    try {
      const resolvedSource = (await runtime.resolveSource()) || snapshot.source
      update((current) => (current.source === resolvedSource ? current : { ...current, source: resolvedSource }))
      const pending = releaseKindsToLoad(snapshot.cache, resolvedSource, kinds, force)
      if (!pending.length) return
      update((current) => (current.busy ? current : { ...current, busy: true }))
      const installations = await runtime.listInstallations().catch(() => null)
      const results = await Promise.all(pending.map((kind) => loadCandidates(runtime, kind)))
      update((current) => {
        let cache = current.cache
        for (const result of results) {
          cache = writeReleaseCache(cache, resolvedSource, result.kind, { candidates: result.candidates, failure: result.failure })
        }
        return {
          cache,
          source: resolvedSource,
          installations: installations ?? current.installations,
          busy: false,
        }
      })
    } catch (error: any) {
      update((current) => (current.busy ? { ...current, busy: false } : current))
      onError(String(error?.message || error || '读取发行候选失败'))
    }
  }

  // read 是打开商店或按分类读取：缓存新鲜时复用，不发起读取。
  const read = (kind?: string) => load([(kind || 'tool') as ReleaseArtifactKind], false)

  // refresh 是手动刷新入口：无论缓存是否新鲜都重新读取。
  const refresh = (kind?: string) => load(kind ? [kind as ReleaseArtifactKind] : RELEASE_ARTIFACT_KINDS, true)

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    read,
    refresh,
  }
}

async function loadCandidates(runtime: ReleaseStoreRuntime, kind: ReleaseArtifactKind): Promise<{ kind: ReleaseArtifactKind; candidates: ArtifactCandidateList['candidates']; failure: string }> {
  try {
    const list = await runtime.listCandidates(kind)
    return { kind, candidates: list.candidates, failure: '' }
  } catch (error: any) {
    return { kind, candidates: [], failure: String(error?.message || error || `读取 ${kind} 发行候选失败`) }
  }
}

function sameSnapshot(left: ReleaseStoreSnapshot, right: ReleaseStoreSnapshot): boolean {
  return left.cache === right.cache && left.source === right.source && left.installations === right.installations && left.busy === right.busy
}
