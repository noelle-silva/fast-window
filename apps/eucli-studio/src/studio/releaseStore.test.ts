import { describe, expect, it } from 'vitest'
import { createReleaseStore, type ReleaseStoreRuntime } from './releaseStore'
import type { ArtifactCandidateList, ArtifactReleaseCandidate, ReleaseArtifactKind, ReleaseSourceKind } from '../domain/release'

function candidate(kind: string, id: string, version: string): ArtifactReleaseCandidate {
  return {
    artifact: { kind, id },
    source: { kind, repository: '', owner: '', name: '' },
    installed: false,
    currentVersion: '',
    latestVersion: version,
    status: 'completed',
    publishedAt: '',
    updateAvailable: true,
    releaseUrl: '',
    releaseNotes: '',
    downloadSize: 0,
    compatibility: null,
    affectedArtifacts: [],
    failureReason: '',
  }
}

function createFakeRuntime(overrides: Partial<ReleaseStoreRuntime> = {}) {
  const calls = { resolveSource: 0, listInstallations: 0, listCandidates: [] as string[] }
  const runtime: ReleaseStoreRuntime = {
    resolveSource: async () => {
      calls.resolveSource += 1
      return 'official'
    },
    listInstallations: async () => {
      calls.listInstallations += 1
      return []
    },
    listCandidates: async (kind: ReleaseArtifactKind): Promise<ArtifactCandidateList> => {
      calls.listCandidates.push(kind)
      return { source: 'official', candidates: [candidate(kind, `${kind}-demo`, '0.1.0')] }
    },
    ...overrides,
  }
  return { runtime, calls }
}

function noopError(): string[] {
  const errors: string[] = []
  return errors
}

describe('release store core', () => {
  it('reads the current source when opened and writes one source-kind cell', async () => {
    const { runtime, calls } = createFakeRuntime()
    const errors = noopError()
    const store = createReleaseStore(() => runtime, (message) => errors.push(message))
    const busyStates: boolean[] = []
    store.subscribe(() => busyStates.push(store.getSnapshot().busy))

    await store.read('tool')

    expect(calls.listCandidates).toEqual(['tool'])
    expect(calls.listInstallations).toBe(1)
    const snapshot = store.getSnapshot()
    expect(snapshot.source).toBe('official')
    expect(snapshot.busy).toBe(false)
    expect(snapshot.cache.official.tool.candidates.map((item) => item.artifact.id)).toEqual(['tool-demo'])
    expect(snapshot.cache.local.tool.candidates).toHaveLength(0)
    expect(busyStates).toEqual([true, false])
    expect(errors).toEqual([])
  })

  it('reuses a fresh cache without fetching or notifying', async () => {
    const { runtime, calls } = createFakeRuntime()
    const store = createReleaseStore(() => runtime, () => {})
    await store.read('tool')
    const before = store.getSnapshot()
    let notified = 0
    store.subscribe(() => { notified += 1 })

    await store.read('tool')

    expect(calls.listCandidates).toEqual(['tool'])
    expect(notified).toBe(0)
    expect(store.getSnapshot()).toBe(before)
  })

  it('re-reads the same kind on forced refresh', async () => {
    const { runtime, calls } = createFakeRuntime()
    const store = createReleaseStore(() => runtime, () => {})
    await store.read('tool')
    await store.refresh('tool')
    expect(calls.listCandidates).toEqual(['tool', 'tool'])
    expect(store.getSnapshot().busy).toBe(false)
  })

  it('keeps official and local caches isolated when the source changes', async () => {
    let source: ReleaseSourceKind = 'official'
    const { runtime } = createFakeRuntime({
      resolveSource: async () => source,
      listCandidates: async (kind) => ({ source, candidates: [candidate(kind, `${source}-${kind}`, '0.1.0')] }),
    })
    const store = createReleaseStore(() => runtime, () => {})

    await store.read('tool')
    source = 'local'
    await store.read('tool')

    expect(store.getSnapshot().cache.official.tool.candidates[0].artifact.id).toBe('official-tool')
    expect(store.getSnapshot().cache.local.tool.candidates[0].artifact.id).toBe('local-tool')
    expect(store.getSnapshot().source).toBe('local')
  })

  it('keeps the current source when the source cannot be resolved', async () => {
    const { runtime, calls } = createFakeRuntime({ resolveSource: async () => null })
    const store = createReleaseStore(() => runtime, () => {})

    await store.read('tool')

    expect(calls.listCandidates).toEqual(['tool'])
    expect(store.getSnapshot().source).toBe('official')
    expect(store.getSnapshot().cache.official.tool.candidates).toHaveLength(1)
  })

  it('records a candidate failure in its cell and retries it on the next read', async () => {
    let attempts = 0
    const { runtime } = createFakeRuntime({
      listCandidates: async () => {
        attempts += 1
        throw new Error('候选读取失败')
      },
    })
    const store = createReleaseStore(() => runtime, () => {})

    await store.read('tool')
    expect(store.getSnapshot().cache.official.tool.failure).toContain('候选读取失败')
    expect(store.getSnapshot().busy).toBe(false)

    await store.read('tool')
    expect(attempts).toBe(2)
  })
})
