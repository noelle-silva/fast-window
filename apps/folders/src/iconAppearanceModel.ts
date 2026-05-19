import { itemTargetValue } from './categoryRegistry'
import type { CollectionItem, DesktopIcon, IconAppearanceCandidate, IconAppearanceState, WebIconCandidate } from './types'

export const DEFAULT_ICON_CANDIDATE_ID = 'default-icon'

export const defaultDesktopIcon: DesktopIcon = { kind: 'color', color: '#8FA99B' }

export const defaultIconCandidate: IconAppearanceCandidate = {
  id: DEFAULT_ICON_CANDIDATE_ID,
  label: '默认图标',
  icon: defaultDesktopIcon,
}

export function emptyIconAppearanceState(): IconAppearanceState {
  return { draftIcon: null, candidates: [defaultIconCandidate] }
}

export function iconAppearanceStateForItem(item: CollectionItem): IconAppearanceState {
  const current = item.icon || null
  return {
    draftIcon: current,
    candidates: current ? upsertIconCandidate([defaultIconCandidate], { id: 'current-icon', label: '当前图标', icon: current }) : [defaultIconCandidate],
  }
}

export function systemIconCandidateId(item: CollectionItem): string {
  return systemIconCandidateIdForTarget(itemTargetValue(item))
}

export function systemIconCandidateIdForTarget(target: string): string {
  return `system-icon:${target}`
}

export function importedIconCandidateId(assetId: string): string {
  return `image-icon:${assetId}`
}

export function webIconCandidateId(candidate: WebIconCandidate): string {
  return candidate.id
}

export function webIconCandidateLabel(candidate: WebIconCandidate): string {
  const dimensions = candidate.width && candidate.height ? `${candidate.width}x${candidate.height}` : candidate.sizes || ''
  const source = webIconSourceLabel(candidate.source)
  return [source, dimensions].filter(Boolean).join(' ')
}

export function iconAppearanceCandidateFromWebIcon(candidate: unknown): IconAppearanceCandidate {
  if (!isWebIconCandidate(candidate)) throw new Error('网页图标候选数据无效')
  const icon = candidate.assetId ? { kind: 'image' as const, assetId: candidate.assetId } : undefined
  return { id: webIconCandidateId(candidate), label: webIconCandidateLabel(candidate), icon, dataUrl: candidate.dataUrl }
}

function isWebIconCandidate(value: unknown): value is WebIconCandidate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WebIconCandidate>
  return typeof candidate.id === 'string'
    && typeof candidate.label === 'string'
    && typeof candidate.source === 'string'
    && typeof candidate.url === 'string'
    && typeof candidate.mediaType === 'string'
    && (typeof candidate.assetId === 'string' || (typeof candidate.dataUrl === 'string' && candidate.dataUrl.startsWith('data:image/')))
}

function webIconSourceLabel(source: string): string {
  switch (source) {
    case 'manifest': return 'Manifest'
    case 'html': return '网页图标'
    case 'meta': return '元信息图'
    case 'conventional': return '约定图标'
    default: return '网页图标'
  }
}

export function upsertIconCandidate(candidates: IconAppearanceCandidate[], candidate: IconAppearanceCandidate): IconAppearanceCandidate[] {
  const index = candidates.findIndex(current => current.id === candidate.id)
  if (index < 0) return [...candidates, candidate]
  return candidates.map((current, currentIndex) => currentIndex === index ? candidate : current)
}

export function upsertIconCandidates(candidates: IconAppearanceCandidate[], nextCandidates: IconAppearanceCandidate[]): IconAppearanceCandidate[] {
  return nextCandidates.reduce((current, candidate) => upsertIconCandidate(current, candidate), candidates)
}

export function sameDesktopIcon(a: DesktopIcon | null | undefined, b: DesktopIcon | null | undefined): boolean {
  if (!a || !b) return !a && !b
  if (a.kind !== b.kind) return false
  if (a.kind === 'color' && b.kind === 'color') return a.color.toUpperCase() === b.color.toUpperCase()
  if (a.kind === 'image' && b.kind === 'image') return a.assetId === b.assetId
  return false
}
