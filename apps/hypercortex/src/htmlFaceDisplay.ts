import type { HyperCortexHtmlFaceDisplayModeV1 } from './core'

export const HTML_FACE_FIXED_VIEWPORT = {
  width: 1280,
  height: 900,
} as const

export const HTML_FACE_FIXED_SCALE = {
  default: 0.95,
  min: 0.25,
  max: 2,
  step: 0.01,
} as const

export const DEFAULT_HTML_FACE_DISPLAY_MODE: HyperCortexHtmlFaceDisplayModeV1 = 'fixed-fit'

export const HTML_FACE_DISPLAY_MODE_OPTIONS = [
  {
    id: 'natural',
    label: '自然撑开',
    description: 'iframe 高度随内容自动伸展，滚动由外层页面接管。',
  },
  {
    id: 'fit-window',
    label: '随窗口自适应',
    description: 'iframe 铺满当前可用区域，内容在 iframe 内部独立滚动。',
  },
  {
    id: 'fixed-fit',
    label: '固定视口缩放',
    description: `以 ${HTML_FACE_FIXED_VIEWPORT.width}×${HTML_FACE_FIXED_VIEWPORT.height} 固定视口渲染，自动缩放以确保内容完整可见，可手动调整缩放比例。`,
  },
] as const satisfies readonly {
  id: HyperCortexHtmlFaceDisplayModeV1
  label: string
  description: string
}[]

export function isHtmlFaceDisplayMode(value: unknown): value is HyperCortexHtmlFaceDisplayModeV1 {
  return value === 'natural' || value === 'fit-window' || value === 'fixed-fit'
}

export function normalizeHtmlFaceDisplayMode(value: unknown): HyperCortexHtmlFaceDisplayModeV1 {
  return isHtmlFaceDisplayMode(value) ? value : DEFAULT_HTML_FACE_DISPLAY_MODE
}

export function clampHtmlFaceFixedScale(value: number): number {
  if (!Number.isFinite(value)) return HTML_FACE_FIXED_SCALE.default
  if (value < HTML_FACE_FIXED_SCALE.min) return HTML_FACE_FIXED_SCALE.min
  if (value > HTML_FACE_FIXED_SCALE.max) return HTML_FACE_FIXED_SCALE.max
  return value
}

function finiteNumberFrom(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function normalizeHtmlFaceFixedScale(value: unknown, fallback = HTML_FACE_FIXED_SCALE.default): number {
  const n = finiteNumberFrom(value)
  return clampHtmlFaceFixedScale(n === null ? fallback : n)
}
