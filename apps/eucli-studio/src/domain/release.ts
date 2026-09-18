export type EucliBoxCompatibility = {
  minimumVersion: string
  maximumVersionExclusive: string
}

export type CompatibilityStatus = {
  compatible: boolean
  reason: string
  currentEucliBoxVersion: string
  requiredEucliBoxCompatibility: EucliBoxCompatibility
}

export type ReleaseArtifactIdentity = {
  kind: 'tool' | 'plugin' | string
  id: string
}

export type OfficialReleaseSource = {
  kind: string
  repository: string
  owner: string
  name: string
}

// ArtifactInstallation 是业务端当前真实的已装事实。
export type ArtifactInstallation = {
  artifact: ReleaseArtifactIdentity
  version: string
  eucliBoxCompatibility: EucliBoxCompatibility | null
  failureReason: string
}

export type ArtifactInstallationList = {
  artifacts: ArtifactInstallation[]
}

// ArtifactReleaseCandidate 是某个发布物在某个来源下的可用候选事实与比对结论。
export type ArtifactReleaseCandidate = {
  artifact: ReleaseArtifactIdentity
  source: OfficialReleaseSource
  installed: boolean
  currentVersion: string
  latestVersion: string
  status: 'completed' | 'failed' | string
  publishedAt: string
  updateAvailable: boolean
  releaseUrl: string
  releaseNotes: string
  downloadSize: number
  compatibility: CompatibilityStatus | null
  affectedArtifacts: ReleaseArtifactIdentity[]
  failureReason: string
}

export type ArtifactCandidateList = {
  source: 'official' | 'local' | string
  candidates: ArtifactReleaseCandidate[]
}

export type ReleaseSourceKind = 'official' | 'local'

export type ReleaseArtifactKind = 'tool' | 'plugin'

export const RELEASE_SOURCE_KINDS: ReleaseSourceKind[] = ['official', 'local']

export const RELEASE_ARTIFACT_KINDS: ReleaseArtifactKind[] = ['tool', 'plugin']

export type ReleaseOperationProgress = {
  receivedBytes: number
  totalBytes: number
}

export type ReleaseOperationError = {
  code: string
  phase: string
  message: string
}

export type ArtifactInstallState = {
  operationId: string
  artifact: ReleaseArtifactIdentity
  installed: boolean
  currentVersion: string
  targetVersion: string
  status: string
  phase: string
  progress: ReleaseOperationProgress
  error: ReleaseOperationError
}

export type ArtifactActivityState = {
  artifact: ReleaseArtifactIdentity
  active: boolean
  activeRequests: number
  updating: boolean
  reason: string
}

export const artifactStatusLabels: Record<string, string> = {
  not_installed: '未安装',
  checking_release: '检查发行中',
  ready_to_install: '可安装',
  ready_to_update: '可更新',
  downloading: '下载中',
  verifying: '核对中',
  checking_activity: '检查活动中',
  preparing: '准备中',
  switching: '切换中',
  starting: '启动中',
  active: '已启用',
  unavailable: '不适用',
  failed: '失败',
  blocked: '被阻止',
  restoring: '恢复中',
}

export function normalizeArtifactInstallState(value: unknown): ArtifactInstallState {
  const source = objectValue(value)
  return {
    operationId: text(source.operationId),
    artifact: normalizeReleaseArtifactIdentity(source.artifact),
    installed: source.installed === true,
    currentVersion: text(source.currentVersion),
    targetVersion: text(source.targetVersion),
    status: text(source.status),
    phase: text(source.phase),
    progress: {
      receivedBytes: finiteNumber((source as any).progress?.receivedBytes),
      totalBytes: finiteNumber((source as any).progress?.totalBytes),
    },
    error: {
      code: text((source as any).error?.code),
      phase: text((source as any).error?.phase),
      message: text((source as any).error?.message),
    },
  }
}

export function normalizeArtifactActivityState(value: unknown): ArtifactActivityState {
  const source = objectValue(value)
  return {
    artifact: normalizeReleaseArtifactIdentity(source.artifact),
    active: source.active === true,
    activeRequests: finiteNumber(source.activeRequests),
    updating: source.updating === true,
    reason: text(source.reason),
  }
}

export type StudioBootstrap = {
  clientVersion: string
  clientEucliBoxCompatibility: EucliBoxCompatibility
  eucliBoxConfigured: boolean
  eucliBoxReachable: boolean
  eucliBoxUrl: string
  eucliBoxVersion: string
  eucliBoxCompatibility: CompatibilityStatus | null
  businessAvailable: boolean
  eucliBoxIssue: string
}

export function normalizeEucliBoxCompatibility(value: unknown): EucliBoxCompatibility {
  const source = objectValue(value)
  return {
    minimumVersion: text(source.minimumVersion),
    maximumVersionExclusive: text(source.maximumVersionExclusive),
  }
}

export function normalizeCompatibilityStatus(value: unknown): CompatibilityStatus {
  const source = objectValue(value)
  return {
    compatible: source.compatible === true,
    reason: text(source.reason),
    currentEucliBoxVersion: text(source.currentEucliBoxVersion),
    requiredEucliBoxCompatibility: normalizeEucliBoxCompatibility(source.requiredEucliBoxCompatibility),
  }
}

export function normalizeStudioBootstrap(value: unknown): StudioBootstrap {
  const source = objectValue(value)
  return {
    clientVersion: text(source.clientVersion),
    clientEucliBoxCompatibility: normalizeEucliBoxCompatibility(source.clientEucliBoxCompatibility),
    eucliBoxConfigured: source.eucliBoxConfigured === true,
    eucliBoxReachable: source.eucliBoxReachable === true,
    eucliBoxUrl: text(source.eucliBoxUrl),
    eucliBoxVersion: text(source.eucliBoxVersion),
    eucliBoxCompatibility: source.eucliBoxCompatibility && typeof source.eucliBoxCompatibility === 'object'
      ? normalizeCompatibilityStatus(source.eucliBoxCompatibility)
      : null,
    businessAvailable: source.businessAvailable === true,
    eucliBoxIssue: text(source.eucliBoxIssue),
  }
}

export function normalizeArtifactCandidateList(value: unknown): ArtifactCandidateList {
  const source = objectValue(value)
  return {
    source: text(source.source),
    candidates: Array.isArray(source.candidates) ? source.candidates.map(normalizeArtifactReleaseCandidate) : [],
  }
}

export function normalizeArtifactInstallationList(value: unknown): ArtifactInstallationList {
  const source = objectValue(value)
  return {
    artifacts: Array.isArray(source.artifacts) ? source.artifacts.map(normalizeArtifactInstallation) : [],
  }
}

// ---------------------------------------------------------------------------
// 客户端发行缓存：按「来源 × 分类」各自成格；本地与官方互不覆盖。
// ---------------------------------------------------------------------------

// RELEASE_CACHE_FRESHNESS_MS 是客户端复用已有缓存的有效期；期内不重新读取。
export const RELEASE_CACHE_FRESHNESS_MS = 5 * 60 * 1000

export type ReleaseCacheCell = {
  checkedAt: string
  candidates: ArtifactReleaseCandidate[]
  failure: string
}

export type ReleaseCache = Record<ReleaseSourceKind, Record<ReleaseArtifactKind, ReleaseCacheCell>>

export function emptyReleaseCacheCell(): ReleaseCacheCell {
  return { checkedAt: '', candidates: [], failure: '' }
}

export function emptyReleaseCache(): ReleaseCache {
  return {
    official: { tool: emptyReleaseCacheCell(), plugin: emptyReleaseCacheCell() },
    local: { tool: emptyReleaseCacheCell(), plugin: emptyReleaseCacheCell() },
  }
}

export function releaseCacheCell(cache: ReleaseCache, sourceKind: ReleaseSourceKind, artifactKind: ReleaseArtifactKind): ReleaseCacheCell {
  return cache[sourceKind][artifactKind]
}

export function isReleaseCacheFresh(cache: ReleaseCache, sourceKind: ReleaseSourceKind, artifactKind: ReleaseArtifactKind): boolean {
  const cell = releaseCacheCell(cache, sourceKind, artifactKind)
  if (!cell.candidates.length || cell.failure) return false
  const time = Date.parse(cell.checkedAt)
  return Number.isFinite(time) && time > 0 && Date.now() - time < RELEASE_CACHE_FRESHNESS_MS
}

// releaseKindsToLoad 返回本次需要读取的分类：强制刷新时全读，否则只读没有新鲜缓存的分类。
export function releaseKindsToLoad(
  cache: ReleaseCache,
  sourceKind: ReleaseSourceKind,
  kinds: ReleaseArtifactKind[],
  force: boolean,
): ReleaseArtifactKind[] {
  return kinds.filter((kind) => force || !isReleaseCacheFresh(cache, sourceKind, kind))
}

export function writeReleaseCache(
  cache: ReleaseCache,
  sourceKind: ReleaseSourceKind,
  artifactKind: ReleaseArtifactKind,
  result: { candidates: ArtifactReleaseCandidate[]; failure: string },
): ReleaseCache {
  const cell: ReleaseCacheCell = {
    checkedAt: new Date().toISOString(),
    candidates: result.candidates.filter((item) => String(item.artifact?.kind || '') === artifactKind),
    failure: result.failure,
  }
  return { ...cache, [sourceKind]: { ...cache[sourceKind], [artifactKind]: cell } }
}

export type ReleaseCandidatesView = {
  status: 'not_checked' | 'checking' | 'completed' | 'failed'
  statuses: Record<string, 'not_checked' | 'checking' | 'completed' | 'failed'>
  source: ReleaseSourceKind
  checkedAt: string
  checkedAts: Record<string, string>
  failing: string[]
  candidates: ArtifactReleaseCandidate[]
  installations: ArtifactInstallation[]
  sourceCandidates: Record<ReleaseSourceKind, ArtifactReleaseCandidate[]>
  sourceCheckedAts: Record<ReleaseSourceKind, Record<ReleaseArtifactKind, string>>
}

export function composeReleaseCandidatesView(
  cache: ReleaseCache,
  sourceKind: ReleaseSourceKind,
  options: { kinds: ReleaseArtifactKind[]; checking: boolean; installations?: ArtifactInstallation[] },
): ReleaseCandidatesView {
  const statuses: Record<string, 'not_checked' | 'checking' | 'completed' | 'failed'> = {}
  const checkedAts: Record<string, string> = {}
  const failing: string[] = []
  const candidates: ArtifactReleaseCandidate[] = []
  for (const kind of options.kinds) {
    const cell = cache[sourceKind][kind]
    checkedAts[kind] = cell.candidates.length ? cell.checkedAt : ''
    if (options.checking) {
      statuses[kind] = 'checking'
    } else if (cell.candidates.length) {
      statuses[kind] = cell.failure ? 'failed' : 'completed'
    } else {
      statuses[kind] = 'not_checked'
    }
    if (cell.failure) failing.push(cell.failure)
    candidates.push(...cell.candidates)
  }
  candidates.sort((left, right) => {
    const leftKey = `${left.artifact.kind}:${left.artifact.id}`
    const rightKey = `${right.artifact.kind}:${right.artifact.id}`
    return leftKey.localeCompare(rightKey)
  })
  const hasCandidates = candidates.length > 0
  const hasFailure = options.kinds.some((kind) => cache[sourceKind][kind].failure !== '')
  const status = options.checking
    ? 'checking'
    : hasCandidates
      ? (hasFailure ? 'failed' : 'completed')
      : 'not_checked'
  return {
    status,
    statuses,
    source: sourceKind,
    checkedAt: newestCheckedAt(checkedAts),
    checkedAts,
    failing,
    candidates,
    installations: options.installations ? [...options.installations] : [],
    sourceCandidates: {
      official: collectSourceCandidates(cache, 'official'),
      local: collectSourceCandidates(cache, 'local'),
    },
    sourceCheckedAts: {
      official: { tool: cache.official.tool.checkedAt, plugin: cache.official.plugin.checkedAt },
      local: { tool: cache.local.tool.checkedAt, plugin: cache.local.plugin.checkedAt },
    },
  }
}

function collectSourceCandidates(cache: ReleaseCache, sourceKind: ReleaseSourceKind): ArtifactReleaseCandidate[] {
  return [
    ...cache[sourceKind].tool.candidates,
    ...cache[sourceKind].plugin.candidates,
  ]
}

function newestCheckedAt(checkedAts: Record<string, string>): string {
  let newest = ''
  let newestTime = 0
  for (const value of Object.values(checkedAts)) {
    const time = Date.parse(value)
    if (Number.isFinite(time) && time > newestTime) {
      newest = value
      newestTime = time
    }
  }
  return newest
}

export function compatibilityRangeText(value: EucliBoxCompatibility | null | undefined): string {
  const minimum = text(value?.minimumVersion)
  const maximum = text(value?.maximumVersionExclusive)
  if (!minimum || !maximum) return '范围资料无效'
  return `[${minimum}, ${maximum})`
}

function normalizeArtifactReleaseCandidate(value: unknown): ArtifactReleaseCandidate {
  const source = objectValue(value)
  return {
    artifact: normalizeReleaseArtifactIdentity(source.artifact),
    source: normalizeOfficialReleaseSource(source.source),
    installed: source.installed === true,
    currentVersion: text(source.currentVersion),
    latestVersion: text(source.latestVersion),
    status: text(source.status) || 'not_checked',
    publishedAt: text(source.publishedAt),
    updateAvailable: source.updateAvailable === true,
    releaseUrl: text(source.releaseUrl),
    releaseNotes: text(source.releaseNotes),
    downloadSize: finiteNumber(source.downloadSize),
    compatibility: source.compatibility && typeof source.compatibility === 'object'
      ? normalizeCompatibilityStatus(source.compatibility)
      : null,
    affectedArtifacts: Array.isArray(source.affectedArtifacts)
      ? source.affectedArtifacts.map(normalizeReleaseArtifactIdentity)
      : [],
    failureReason: text(source.failureReason),
  }
}

function normalizeArtifactInstallation(value: unknown): ArtifactInstallation {
  const source = objectValue(value)
  return {
    artifact: normalizeReleaseArtifactIdentity(source.artifact),
    version: text(source.version),
    eucliBoxCompatibility: source.eucliBoxCompatibility && typeof source.eucliBoxCompatibility === 'object'
      ? normalizeEucliBoxCompatibility(source.eucliBoxCompatibility)
      : null,
    failureReason: text(source.failureReason),
  }
}

function normalizeReleaseArtifactIdentity(value: unknown): ReleaseArtifactIdentity {
  const source = objectValue(value)
  return { kind: text(source.kind), id: text(source.id) }
}

function normalizeOfficialReleaseSource(value: unknown): OfficialReleaseSource {
  const source = objectValue(value)
  return {
    kind: text(source.kind),
    repository: text(source.repository),
    owner: text(source.owner),
    name: text(source.name),
  }
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function finiteNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}
