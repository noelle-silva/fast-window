import { describe, expect, it } from 'vitest'
import {
  composeReleaseCandidatesView,
  emptyReleaseCache,
  isArtifactBusy,
  isArtifactCancelable,
  isReleaseCacheFresh,
  normalizeArtifactInstallStateList,
  pruneReleaseCache,
  releaseCacheCell,
  releaseKindsToLoad,
  RELEASE_CACHE_FRESHNESS_MS,
  writeReleaseCache,
  type ArtifactInstallState,
  type ArtifactReleaseCandidate,
} from './release'

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

describe('artifact install state guards', () => {
  function installState(status: string, phase = ''): ArtifactInstallState {
    return {
      operationId: 'op',
      artifact: { kind: 'tool', id: 'demo' },
      installed: false,
      currentVersion: '',
      targetVersion: '',
      status,
      phase,
      progress: { receivedBytes: 0, totalBytes: 0 },
      error: { code: '', phase: '', message: '' },
    }
  }

  it('treats running statuses as busy and terminal statuses as not busy', () => {
    for (const status of ['checking_release', 'downloading', 'verifying', 'preparing', 'switching', 'starting', 'restoring', 'checking_activity']) {
      expect(isArtifactBusy(installState(status))).toBe(true)
    }
    for (const status of ['active', 'failed', 'blocked', 'cancelled', 'not_installed', 'unavailable', '']) {
      expect(isArtifactBusy(installState(status))).toBe(false)
    }
    expect(isArtifactBusy(null)).toBe(false)
  })

  it('allows cancelling only before the switch phase', () => {
    expect(isArtifactCancelable(installState('downloading', 'download'))).toBe(true)
    expect(isArtifactCancelable(installState('preparing', 'prepare'))).toBe(true)
    expect(isArtifactCancelable(installState('starting', 'probe'))).toBe(true)
    expect(isArtifactCancelable(installState('switching', 'switch'))).toBe(false)
    expect(isArtifactCancelable(installState('restoring', 'restore'))).toBe(false)
    expect(isArtifactCancelable(installState('failed', 'download'))).toBe(false)
  })

  it('normalizes a batch operation list', () => {
    const list = normalizeArtifactInstallStateList({
      operations: [
        { artifact: { kind: 'tool', id: 'a' }, status: 'downloading', progress: { receivedBytes: 5, totalBytes: 10 } },
        { artifact: { kind: 'plugin', id: 'b' }, status: 'cancelled' },
      ],
    })
    expect(list).toHaveLength(2)
    expect(list[0].artifact.id).toBe('a')
    expect(list[0].progress.receivedBytes).toBe(5)
    expect(list[1].status).toBe('cancelled')
    expect(normalizeArtifactInstallStateList(null)).toEqual([])
  })
})

describe('release cache', () => {
  it('writes one kind-source cell without touching other cells', () => {
    const cache = writeReleaseCache(emptyReleaseCache(), 'tool', 'official', {
      candidates: [candidate('tool', 'context7', '0.1.2')],
      failure: '',
    })
    expect(releaseCacheCell(cache, 'tool', 'official').candidates).toHaveLength(1)
    expect(releaseCacheCell(cache, 'plugin', 'official').candidates).toHaveLength(0)
    expect(releaseCacheCell(cache, 'tool', '甲').candidates).toHaveLength(0)
    expect(isReleaseCacheFresh(cache, 'tool', 'official')).toBe(true)
    expect(isReleaseCacheFresh(cache, 'tool', '甲')).toBe(false)
    expect(isReleaseCacheFresh(cache, 'plugin', 'official')).toBe(false)
  })

  it('rejects an expired cell or a cell without candidates', () => {
    const cache = writeReleaseCache(emptyReleaseCache(), 'tool', 'official', {
      candidates: [candidate('tool', 'context7', '0.1.2')],
      failure: '',
    })
    const cell = releaseCacheCell(cache, 'tool', 'official')
    cell.checkedAt = new Date(Date.now() - RELEASE_CACHE_FRESHNESS_MS - 1000).toISOString()
    expect(isReleaseCacheFresh(cache, 'tool', 'official')).toBe(false)
    cell.checkedAt = new Date().toISOString()
    cell.candidates = []
    expect(isReleaseCacheFresh(cache, 'tool', 'official')).toBe(false)
  })

  it('keeps caches for different sources independent', () => {
    let cache = writeReleaseCache(emptyReleaseCache(), 'plugin', 'official', {
      candidates: [candidate('plugin', 'time-plugin', '0.1.0')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'plugin', '甲', {
      candidates: [candidate('plugin', 'time-plugin', '0.0.9')],
      failure: '',
    })
    expect(releaseCacheCell(cache, 'plugin', 'official').candidates[0].latestVersion).toBe('0.1.0')
    expect(releaseCacheCell(cache, 'plugin', '甲').candidates[0].latestVersion).toBe('0.0.9')
  })

  it('prunes source keys that are no longer in the kind registry', () => {
    let cache = writeReleaseCache(emptyReleaseCache(), 'tool', '甲', {
      candidates: [candidate('tool', 'a', '0.1.0')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'tool', '乙', {
      candidates: [candidate('tool', 'b', '0.1.0')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'tool', 'official', {
      candidates: [candidate('tool', 'c', '0.1.0')],
      failure: '',
    })
    const pruned = pruneReleaseCache(cache, 'tool', ['乙'])
    expect(Object.keys(pruned.tool!).sort()).toEqual(['official', '乙'])
    expect(pruneReleaseCache(cache, 'tool', ['甲', '乙'])).toBe(cache)
  })

  it('prunes only the requested kind', () => {
    let cache = writeReleaseCache(emptyReleaseCache(), 'tool', '甲', {
      candidates: [candidate('tool', 'a', '0.1.0')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'plugin', '甲', {
      candidates: [candidate('plugin', 'p', '0.1.0')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'plugin', '乙', {
      candidates: [candidate('plugin', 'q', '0.1.0')],
      failure: '',
    })
    const pruned = pruneReleaseCache(cache, 'tool', ['乙'])
    expect(pruned.tool).toEqual({})
    expect(Object.keys(pruned.plugin!).sort()).toEqual(['乙', '甲'])
  })
})

describe('releaseKindsToLoad', () => {
  it('loads every requested kind when nothing is cached', () => {
    const cache = emptyReleaseCache()
    expect(releaseKindsToLoad(cache, { tool: 'official', plugin: 'official' }, ['tool', 'plugin'], false)).toEqual(['tool', 'plugin'])
  })

  it('skips fresh cells and keeps expired or failed ones', () => {
    let cache = writeReleaseCache(emptyReleaseCache(), 'tool', 'official', {
      candidates: [candidate('tool', 'context7', '0.1.2')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'plugin', 'official', {
      candidates: [candidate('plugin', 'time-plugin', '0.1.0')],
      failure: '',
    })
    releaseCacheCell(cache, 'plugin', 'official').checkedAt = new Date(Date.now() - RELEASE_CACHE_FRESHNESS_MS - 1000).toISOString()
    expect(releaseKindsToLoad(cache, { tool: 'official', plugin: 'official' }, ['tool', 'plugin'], false)).toEqual(['plugin'])
  })

  it('reloads failed cells even when freshly checked', () => {
    const cache = writeReleaseCache(emptyReleaseCache(), 'plugin', 'official', {
      candidates: [],
      failure: '插件候选读取失败',
    })
    expect(releaseKindsToLoad(cache, { tool: 'official', plugin: 'official' }, ['tool', 'plugin'], false)).toEqual(['tool', 'plugin'])
  })

  it('judges freshness against each kind own source', () => {
    let cache = writeReleaseCache(emptyReleaseCache(), 'tool', 'official', {
      candidates: [candidate('tool', 'context7', '0.1.2')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'plugin', '甲', {
      candidates: [candidate('plugin', 'time-plugin', '0.1.0')],
      failure: '',
    })
    expect(releaseKindsToLoad(cache, { tool: 'official', plugin: '甲' }, ['tool', 'plugin'], false)).toEqual([])
    expect(releaseKindsToLoad(cache, { tool: 'official', plugin: 'official' }, ['tool', 'plugin'], false)).toEqual(['plugin'])
  })

  it('loads every requested kind on force refresh', () => {
    const cache = writeReleaseCache(emptyReleaseCache(), 'tool', 'official', {
      candidates: [candidate('tool', 'context7', '0.1.2')],
      failure: '',
    })
    expect(releaseKindsToLoad(cache, { tool: 'official', plugin: 'official' }, ['tool'], true)).toEqual(['tool'])
  })
})

describe('composeReleaseCandidatesView', () => {
  it('composes one kind from its own cells only', () => {
    let cache = writeReleaseCache(emptyReleaseCache(), 'tool', 'official', {
      candidates: [candidate('tool', 'context7', '0.1.2')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'plugin', 'official', { candidates: [], failure: 'plugin: 索引读取失败' })
    const view = composeReleaseCandidatesView(cache, 'tool', { source: 'official', checking: false })
    expect(view.candidates.map((item) => item.artifact.id)).toEqual(['context7'])
    expect(view.status).toBe('completed')
    expect(view.failing).toEqual([])
    expect(view.checkedAt).not.toBe('')

    const pluginView = composeReleaseCandidatesView(cache, 'plugin', { source: 'official', checking: false })
    expect(pluginView.candidates).toEqual([])
    expect(pluginView.status).toBe('not_checked')
    expect(pluginView.failing).toEqual(['plugin: 索引读取失败'])
  })

  it('reports checking without losing cached candidates', () => {
    const cache = writeReleaseCache(emptyReleaseCache(), 'tool', 'official', {
      candidates: [candidate('tool', 'context7', '0.1.2')],
      failure: '',
    })
    const view = composeReleaseCandidatesView(cache, 'tool', { source: 'official', checking: true })
    expect(view.status).toBe('checking')
    expect(view.candidates).toHaveLength(1)
  })

  it('exposes every cached source of the kind for store switching', () => {
    let cache = writeReleaseCache(emptyReleaseCache(), 'tool', 'official', {
      candidates: [candidate('tool', 'context7', '0.1.2')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'tool', '甲', {
      candidates: [candidate('tool', 'context7', '0.1.1')],
      failure: '',
    })
    cache = writeReleaseCache(cache, 'plugin', '甲', {
      candidates: [candidate('plugin', 'time-plugin', '0.1.0')],
      failure: '',
    })
    const view = composeReleaseCandidatesView(cache, 'tool', { source: 'official', checking: false })
    expect(view.sourceCandidates.official[0].latestVersion).toBe('0.1.2')
    expect(view.sourceCandidates['甲'][0].latestVersion).toBe('0.1.1')
    expect(view.sourceCandidates['甲']).toHaveLength(1)
    expect(view.sourceCheckedAt['甲']).not.toBe('')
  })
})
