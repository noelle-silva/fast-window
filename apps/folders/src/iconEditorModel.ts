import { itemTargetValue } from './categoryRegistry'
import type { DesktopIcon, IconEditorCandidate, IconEditorState, CollectionItem } from './types'

export const DEFAULT_ICON_CANDIDATE_ID = 'default-icon'

export const defaultIconCandidate: IconEditorCandidate = {
  id: DEFAULT_ICON_CANDIDATE_ID,
  label: '默认图标',
  icon: { kind: 'color', color: '#8FA99B' },
}

export function systemIconCandidateId(item: CollectionItem): string {
  return `system-icon:${itemTargetValue(item)}`
}

export function importedIconCandidateId(assetId: string): string {
  return `image-icon:${assetId}`
}

export function createIconEditorState(item: CollectionItem): IconEditorState {
  const current = item.icon || null
  return {
    id: item.id,
    label: item.name,
    target: item.target,
    draftIcon: current,
    candidates: current ? upsertIconCandidate([defaultIconCandidate], { id: 'current-icon', label: '当前图标', icon: current }) : [defaultIconCandidate],
  }
}

export function upsertIconCandidate(candidates: IconEditorCandidate[], candidate: IconEditorCandidate): IconEditorCandidate[] {
  const index = candidates.findIndex(current => current.id === candidate.id)
  if (index < 0) return [...candidates, candidate]
  return candidates.map((current, currentIndex) => currentIndex === index ? candidate : current)
}

export function sameDesktopIcon(a: DesktopIcon | null | undefined, b: DesktopIcon | null | undefined): boolean {
  if (!a || !b) return !a && !b
  if (a.kind !== b.kind) return false
  if (a.kind === 'color' && b.kind === 'color') return a.color.toUpperCase() === b.color.toUpperCase()
  if (a.kind === 'image' && b.kind === 'image') return a.assetId === b.assetId
  return false
}
