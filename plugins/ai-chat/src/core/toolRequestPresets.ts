export type ToolRequestRenderPresetVarKey =
  | 'border'
  | 'bg'
  | 'bgSize'
  | 'bgPos'
  | 'bgAnim'
  | 'shadow'
  | 'radius'
  | 'pad'
  | 'summaryColor'
  | 'badgeBg'
  | 'badgeBorder'
  | 'badgeColor'
  | 'preBg'
  | 'prePad'
  | 'preRadius'
  | 'preBorder'
  | 'preColor'
  | 'backdrop'

export type ToolRequestRenderPreset = {
  id: string
  name: string
  badgeText?: string
  vars?: Partial<Record<ToolRequestRenderPresetVarKey, string>>
}

const VAR_KEYS: ToolRequestRenderPresetVarKey[] = [
  'border',
  'bg',
  'bgSize',
  'bgPos',
  'bgAnim',
  'shadow',
  'radius',
  'pad',
  'summaryColor',
  'badgeBg',
  'badgeBorder',
  'badgeColor',
  'preBg',
  'prePad',
  'preRadius',
  'preBorder',
  'preColor',
  'backdrop',
]

export const BUILTIN_TOOL_REQUEST_PRESETS: ToolRequestRenderPreset[] = [
  {
    id: 'classic',
    name: '经典（默认）',
    badgeText: '',
    vars: {
      border: 'rgba(245,158,11,.25)',
      bg: 'rgba(245,158,11,.05)',
      bgSize: '',
      bgPos: '',
      bgAnim: '',
      shadow: 'none',
      radius: '12px',
      pad: '8px 10px',
      summaryColor: '',
      badgeBg: '',
      badgeBorder: '',
      badgeColor: '',
      preBg: 'rgba(255,255,255,.7)',
      prePad: '8px 10px',
      preRadius: '10px',
      preBorder: 'rgba(245,158,11,.18)',
      preColor: '',
      backdrop: 'none',
    },
  },
  {
    id: 'neon',
    name: '霓虹（赛博）',
    badgeText: 'TOOL',
    vars: {
      border: 'rgba(99,102,241,.45)',
      bg: 'linear-gradient(135deg, rgba(2,6,23,.92), rgba(15,23,42,.92))',
      bgSize: '',
      bgPos: '',
      bgAnim: '',
      shadow: '0 0 0 1px rgba(34,211,238,.10), 0 10px 28px rgba(0,0,0,.22)',
      radius: '14px',
      pad: '10px 12px',
      summaryColor: 'rgba(224,242,254,.96)',
      badgeBg: 'rgba(34,211,238,.12)',
      badgeBorder: 'rgba(34,211,238,.25)',
      badgeColor: 'rgba(34,211,238,.95)',
      preBg: 'rgba(2,6,23,.78)',
      prePad: '10px 12px',
      preRadius: '12px',
      preBorder: 'rgba(99,102,241,.25)',
      preColor: 'rgba(226,232,240,.95)',
      backdrop: 'none',
    },
  },
  {
    id: 'glass',
    name: '玻璃（磨砂）',
    badgeText: 'CALL',
    vars: {
      border: 'rgba(148,163,184,.35)',
      bg: 'rgba(255,255,255,.10)',
      bgSize: '',
      bgPos: '',
      bgAnim: '',
      shadow: '0 10px 24px rgba(15,23,42,.10)',
      radius: '14px',
      pad: '10px 12px',
      summaryColor: 'rgba(15,23,42,.82)',
      badgeBg: 'rgba(37,99,235,.10)',
      badgeBorder: 'rgba(37,99,235,.18)',
      badgeColor: 'rgba(37,99,235,.92)',
      preBg: 'rgba(255,255,255,.72)',
      prePad: '10px 12px',
      preRadius: '12px',
      preBorder: 'rgba(148,163,184,.30)',
      preColor: 'rgba(15,23,42,.78)',
      backdrop: 'blur(10px)',
    },
  },
]

export function findBuiltinToolRequestPreset(id: unknown) {
  const pid = String(id || '').trim()
  if (!pid) return null
  return BUILTIN_TOOL_REQUEST_PRESETS.find((x) => x.id === pid) || null
}

function isSafeCssValue(v: string) {
  const s = String(v || '')
  if (!s) return true
  if (s.length > 220) return false
  if (/[\"\'\;\u0000\r\n<>]/.test(s)) return false
  const low = s.toLowerCase()
  if (low.includes('url(')) return false
  if (low.includes('@import')) return false
  if (low.includes('expression(')) return false
  return true
}

export function validateToolRequestRenderPreset(raw: unknown): { ok: boolean; preset?: ToolRequestRenderPreset; error?: string } {
  const o = raw && typeof raw === 'object' ? (raw as any) : null
  if (!o) return { ok: false, error: '不是对象' }

  const id = String(o.id || '').trim()
  if (!id) return { ok: false, error: '缺少 id' }
  if (id.length > 60) return { ok: false, error: 'id 太长' }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,59}$/.test(id)) return { ok: false, error: 'id 格式不合法' }
  if (findBuiltinToolRequestPreset(id)) return { ok: false, error: '不能覆盖内置预设 id' }

  const name = String(o.name || '').trim()
  if (!name) return { ok: false, error: '缺少 name' }
  if (name.length > 60) return { ok: false, error: 'name 太长' }

  const badgeText = typeof o.badgeText === 'string' ? o.badgeText.trim() : ''
  if (badgeText.length > 16) return { ok: false, error: 'badgeText 太长' }

  const varsIn = o.vars && typeof o.vars === 'object' ? (o.vars as any) : {}
  const varsOut: Partial<Record<ToolRequestRenderPresetVarKey, string>> = {}
  for (const k of VAR_KEYS) {
    const v = varsIn[k]
    if (typeof v !== 'string') continue
    const s = v.trim()
    if (!isSafeCssValue(s)) return { ok: false, error: `vars.${k} 不安全或过长` }
    varsOut[k] = s
  }

  return { ok: true, preset: { id, name, badgeText, vars: varsOut } }
}

export function normalizeToolRequestRenderPresets(raw: unknown) {
  const items = Array.isArray(raw) ? raw : []
  const out: ToolRequestRenderPreset[] = []
  const seen = new Set<string>()
  for (const it of items) {
    const v = validateToolRequestRenderPreset(it)
    if (!v.ok || !v.preset) continue
    if (seen.has(v.preset.id)) continue
    seen.add(v.preset.id)
    out.push(v.preset)
    if (out.length >= 60) break
  }
  return out
}

export function resolveToolRequestRenderPreset(activeId: unknown, userPresets: unknown) {
  const pid = String(activeId || '').trim()
  const builtin = findBuiltinToolRequestPreset(pid)
  if (builtin) return builtin

  const items = Array.isArray(userPresets) ? (userPresets as any[]) : []
  const found = items.find((x) => x && typeof x === 'object' && String((x as any).id || '').trim() === pid) || null
  const v = validateToolRequestRenderPreset(found)
  if (v.ok && v.preset) return v.preset

  return BUILTIN_TOOL_REQUEST_PRESETS[0]
}

const VAR_TO_CSS: Record<ToolRequestRenderPresetVarKey, string> = {
  border: '--fw-toolreq-border',
  bg: '--fw-toolreq-bg',
  bgSize: '--fw-toolreq-bg-size',
  bgPos: '--fw-toolreq-bg-pos',
  bgAnim: '--fw-toolreq-bg-anim',
  shadow: '--fw-toolreq-shadow',
  radius: '--fw-toolreq-radius',
  pad: '--fw-toolreq-pad',
  summaryColor: '--fw-toolreq-summary-color',
  badgeBg: '--fw-toolreq-badge-bg',
  badgeBorder: '--fw-toolreq-badge-border',
  badgeColor: '--fw-toolreq-badge-color',
  preBg: '--fw-toolreq-pre-bg',
  prePad: '--fw-toolreq-pre-pad',
  preRadius: '--fw-toolreq-pre-radius',
  preBorder: '--fw-toolreq-pre-border',
  preColor: '--fw-toolreq-pre-color',
  backdrop: '--fw-toolreq-backdrop',
}

export function presetVarsToInlineStyle(vars: unknown) {
  const o = vars && typeof vars === 'object' ? (vars as any) : null
  if (!o) return ''
  const parts: string[] = []
  for (const k of VAR_KEYS) {
    const cssVar = VAR_TO_CSS[k]
    const v0 = o[k]
    if (typeof v0 !== 'string') continue
    const v = v0.trim()
    if (!v) continue
    if (!isSafeCssValue(v)) continue
    parts.push(`${cssVar}:${v}`)
  }
  return parts.join(';')
}

export function stringifyToolRequestRenderPreset(preset: unknown) {
  const o = preset && typeof preset === 'object' ? (preset as any) : null
  if (!o) return ''
  const id = String(o.id || '').trim()
  const name = String(o.name || '').trim()
  if (!id || !name) return ''
  const badgeText = typeof o.badgeText === 'string' ? o.badgeText : ''
  const vars = o.vars && typeof o.vars === 'object' ? o.vars : {}
  const boxed: any = { id, name }
  if (badgeText) boxed.badgeText = badgeText
  if (vars && typeof vars === 'object') boxed.vars = vars
  try {
    return JSON.stringify(boxed, null, 2)
  } catch {
    return ''
  }
}
