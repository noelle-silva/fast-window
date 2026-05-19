export const HYPERCORTEX_TONES = ['sage', 'sky', 'lavender', 'clay', 'butter'] as const

export type HyperCortexToneId = typeof HYPERCORTEX_TONES[number]

export const FEATURE_TONES = {
  create: 'sage',
  index: 'sky',
  notes: 'lavender',
  assets: 'clay',
  search: 'butter',
  data: 'sky',
  actions: 'butter',
  display: 'lavender',
  trash: 'clay',
} satisfies Record<string, HyperCortexToneId>

export const ASSET_KIND_TONES = {
  image: 'sky',
  video: 'lavender',
  audio: 'butter',
  document: 'clay',
  file: 'sage',
} satisfies Record<string, HyperCortexToneId>

export function toneBgVar(tone: HyperCortexToneId): string {
  return `var(--hc-tone-${tone}-bg)`
}

export function toneHoverVar(tone: HyperCortexToneId): string {
  return `var(--hc-tone-${tone}-hover)`
}

export function toneFgVar(tone: HyperCortexToneId): string {
  return `var(--hc-tone-${tone}-fg)`
}

export function stableToneFromString(value: string): HyperCortexToneId {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return HYPERCORTEX_TONES[Math.abs(hash) % HYPERCORTEX_TONES.length]
}

export function assetToneFromKind(kind: string): HyperCortexToneId {
  const key = String(kind || '').trim().toLowerCase()
  if (key === 'image') return ASSET_KIND_TONES.image
  if (key === 'video') return ASSET_KIND_TONES.video
  if (key === 'audio') return ASSET_KIND_TONES.audio
  if (key === 'document' || key === 'doc' || key === 'pdf' || key === 'word') return ASSET_KIND_TONES.document
  return ASSET_KIND_TONES.file
}

export function noteToneFromIdentity(id: string, title: string): HyperCortexToneId {
  return stableToneFromString(String(id || title || 'note'))
}

export function tagToneFromText(text: string): HyperCortexToneId {
  return stableToneFromString(String(text || 'tag'))
}

export function toneChipSx(tone: HyperCortexToneId) {
  return {
    bgcolor: toneBgVar(tone),
    color: toneFgVar(tone),
  }
}
