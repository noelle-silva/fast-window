import { deriveFullColorTheme } from './colorDerivation'

export type ColorThemeMode = 'light' | 'dark'

// 用户可调、需持久化的基础色：主题数据的唯一事实源。
export type BaseColors = {
  background: string // 应用底色（对应 canvas/appBackground）
  surface: string // 通用表面（对应 paper）
  surfaceCode: string // 代码块表面
  primary: string // 主强调色
  secondary: string // 次强调色
  text: string // 主文字色
  border: string // 边框色
  success: string // 成功状态
  warning: string // 警告状态
  danger: string // 危险状态
}

export const BASE_COLOR_KEYS: Array<keyof BaseColors> = [
  'background',
  'surface',
  'surfaceCode',
  'primary',
  'secondary',
  'text',
  'border',
  'success',
  'warning',
  'danger',
]

export type ColorThemeColors = {
  canvas: string
  paper: string
  paperMuted: string
  paperStrong: string
  appBackground: string
  topbar: string
  composer: string
  field: string
  fieldHover: string
  fieldFocus: string
  primary: string
  primaryHover: string
  primarySoft: string
  secondary: string
  secondarySoft: string
  textPrimary: string
  textSecondary: string
  border: string
  shadowSoft: string
  shadowStrong: string
  focus: string
  codeBackground: string
  codeText: string
  success: string
  danger: string
  warning: string
  // 扩展：语义化状态色
  successBg: string
  successBgStrong: string
  dangerBg: string
  warningBg: string
  successText: string
  dangerText: string
  warningText: string
  // 扩展：System 角色专用
  systemBg: string
  systemBorder: string
  systemText: string
  // 扩展：树形图专用
  treeNodeBg: string
  treeNodeBorder: string
  treeEdge: string
  treeEdgeHighlight: string
  // 扩展：通用组件
  divider: string
  toolbarBg: string
  toolbarBorder: string
  overlay: string
  scrollbarTrack: string
  scrollbarThumb: string
  // 扩展：输入框与表单
  inputBorder: string
  inputBg: string
  buttonText: string
  buttonHoverSubtle: string
  // 扩展：卡片
  cardBorder: string
  cardBg: string
  // 扩展：文本层级
  textTertiary: string
  // 扩展：Toast 通知
  toastBg: string
  toastText: string
  toastBorder: string
  toastShadow: string
  successBgDark: string
  successTextLight: string
  successBorderDark: string
  successShadow: string
  errorBgDark: string
  errorTextLight: string
  errorBorderDark: string
  errorShadow: string
  // Mermaid 浮动操作按钮
  mermaidActionBg: string
  mermaidActionBgHover: string
  mermaidActionText: string
  mermaidActionTextHover: string
  mermaidActionShadow: string
}

export type ColorThemePreset = {
  id: string
  name: string
  description: string
  mode: ColorThemeMode
  baseColors: BaseColors // 必需：所有预设只存基础色
}

/** 获取主题的完整颜色（从基础色实时派生） */
export function getColorThemeColors(preset: ColorThemePreset): ColorThemeColors {
  return deriveFullColorTheme(preset.baseColors, preset.mode)
}

export type ColorThemeSettings = {
  activePresetId: string
  importedPresets: ColorThemePreset[]
}

export const COLOR_THEME_SETTING_KEY = 'colorTheme'

export const COLOR_THEME_BUILTIN_PRESETS: ColorThemePreset[] = [
  {
    id: 'misty-blue',
    name: '晨雾蓝',
    description: '清透、低饱和的浅色工作台，适合长时间阅读和日常对话。',
    mode: 'light',
    baseColors: {
      background: '#eaf2f7',
      surface: '#fffaf3',
      surfaceCode: '#e8eef8',
      primary: '#4f72b8',
      secondary: '#7c3aed',      text: '#0f172a',
      border: 'rgba(15,23,42,.12)',
      success: '#16a34a',
      warning: '#d97706',
      danger: '#dc2626',
    },
  },
  {
    id: 'sakura-night',
    name: '暮樱墨',
    description: '偏暗的紫樱配色，降低白色刺激，突出沉浸式写作和夜间使用。',
    mode: 'dark',
    baseColors: {
      background: '#0d1020',
      surface: '#211827',
      surfaceCode: '#f4eef5',
      primary: '#c884a6',
      secondary: '#a78bfa',      text: '#f8fafc',
      border: 'rgba(255,255,255,.12)',
      success: '#34d399',
      warning: '#fbbf24',
      danger: '#fb7185',
    },
  },
  {
    id: 'macaron-cloud',
    name: '云朵马卡龙',
    description: '轻甜柔和的低饱和彩色层级，适合轻松、明亮的日常使用。',
    mode: 'light',
    baseColors: {
      background: '#f7f1fb',
      surface: '#fff7fb',
      surfaceCode: '#f0e6f7',
      primary: '#9a86c8',
      secondary: '#f472b6',      text: '#312e4f',
      border: 'rgba(49,46,79,.13)',
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#fb7185',
    },
  },
  {
    id: 'moss-green',
    name: '苔林绿',
    description: '偏自然的绿色工作台，强调安静、护眼和稳定阅读。',
    mode: 'light',
    baseColors: {
      background: '#edf7ef',
      surface: '#fbfff7',
      surfaceCode: '#e6f2ea',
      primary: '#4f7f5b',
      secondary: '#0f766e',      text: '#17351f',
      border: 'rgba(23,53,31,.14)',
      success: '#16a34a',
      warning: '#ca8a04',
      danger: '#dc2626',
    },
  },
  {
    id: 'peach-pink',
    name: '蜜桃粉',
    description: '温柔明亮的粉桃色层级，适合轻快、亲和的聊天氛围。',
    mode: 'light',
    baseColors: {
      background: '#fff1f2',
      surface: '#fffaf7',
      surfaceCode: '#fce8ea',
      primary: '#c06a78',
      secondary: '#f97316',      text: '#4a1d2a',
      border: 'rgba(74,29,42,.13)',
      success: '#16a34a',
      warning: '#ea580c',
      danger: '#dc2626',
    },
  },
  {
    id: 'wisteria-purple',
    name: '紫藤雾',
    description: '清爽的紫色层级，适合更有幻想感和专注感的工作台。',
    mode: 'light',
    baseColors: {
      background: '#f3efff',
      surface: '#fbf8ff',
      surfaceCode: '#ece4fa',
      primary: '#8870bd',
      secondary: '#a855f7',      text: '#2e214f',
      border: 'rgba(46,33,79,.13)',
      success: '#16a34a',
      warning: '#d97706',
      danger: '#dc2626',
    },
  },
  {
    id: 'parchment-scroll',
    name: '羊皮纸',
    description: '温暖的纸张色层级，适合写作、阅读和复古笔记氛围。',
    mode: 'light',
    baseColors: {
      background: '#f3ead7',
      surface: '#fff8e8',
      surfaceCode: '#f5ead2',
      primary: '#9a7046',
      secondary: '#a16207',      text: '#3f2f1c',
      border: 'rgba(63,47,28,.16)',
      success: '#15803d',
      warning: '#b45309',
      danger: '#b91c1c',
    },
  },
]

const BUILTIN_PRESET_IDS = new Set(COLOR_THEME_BUILTIN_PRESETS.map((preset) => preset.id))

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function assertSafeCssValue(value: string, fieldName: string) {
  const v = String(value || '').trim()
  if (!v) throw new Error(`${fieldName} 不能为空`)
  if (v.length > 280) throw new Error(`${fieldName} 过长`)
  if (/[;{}<>]/.test(v)) throw new Error(`${fieldName} 包含不允许的字符`)
  if (/gradient\s*\(/i.test(v)) throw new Error(`${fieldName} 不允许使用渐变`)
  if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(v)) throw new Error(`${fieldName} 不能包含外部资源或脚本表达式`)
  if (!/^[a-z0-9#.,%\s()\-]+$/i.test(v)) throw new Error(`${fieldName} 包含不支持的 CSS 片段`)
  return v
}

function normalizePresetId(value: unknown, fallbackId: string) {
  const raw = String(value || '').trim().toLowerCase()
  const id = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return id || fallbackId
}

export function normalizeColorThemePreset(raw: unknown, fallbackId: string): ColorThemePreset {
  if (!raw || typeof raw !== 'object') throw new Error('配色预设必须是对象')
  const obj = raw as any
  const name = cleanText(obj.name, 40)
  if (!name) throw new Error('配色预设缺少 name')

  const modeRaw = String(obj.mode || 'light').trim()
  const mode: ColorThemeMode = modeRaw === 'dark' ? 'dark' : 'light'

  if (!obj.baseColors || typeof obj.baseColors !== 'object') throw new Error('配色预设缺少 baseColors')
  const baseRaw = obj.baseColors as Record<string, unknown>
  const baseColors = {} as BaseColors
  for (const key of BASE_COLOR_KEYS) {
    const value = baseRaw[key]
    if (typeof value !== 'string') throw new Error(`baseColors.${key} 必须是字符串`)
    baseColors[key] = assertSafeCssValue(value, `baseColors.${key}`)
  }

  return {
    id: normalizePresetId(obj.id, fallbackId),
    name,
    description: cleanText(obj.description, 120),
    mode,
    baseColors,
  }
}

export function normalizeColorThemeSettings(raw: unknown): ColorThemeSettings {
  const obj = raw && typeof raw === 'object' ? (raw as any) : {}
  const importedPresets = Array.isArray(obj.importedPresets)
    ? obj.importedPresets
        .map((preset: unknown, index: number) => {
          try {
            const normalized = normalizeColorThemePreset(preset, `imported-${index + 1}`)
            return BUILTIN_PRESET_IDS.has(normalized.id) ? { ...normalized, id: `imported-${index + 1}` } : normalized
          } catch (_) {
            return null
          }
        })
        .filter((preset: ColorThemePreset | null): preset is ColorThemePreset => !!preset)
    : []

  const allIds = new Set<string>([...COLOR_THEME_BUILTIN_PRESETS.map((preset: ColorThemePreset) => preset.id), ...importedPresets.map((preset: ColorThemePreset) => preset.id)])
  const activePresetId = String(obj.activePresetId || '').trim()
  return {
    activePresetId: allIds.has(activePresetId) ? activePresetId : COLOR_THEME_BUILTIN_PRESETS[0].id,
    importedPresets,
  }
}

export function listColorThemePresets(settings: unknown) {
  const normalized = normalizeColorThemeSettings(settings)
  return [...COLOR_THEME_BUILTIN_PRESETS, ...normalized.importedPresets]
}

export function resolveColorThemePreset(settings: unknown): ColorThemePreset {
  const normalized = normalizeColorThemeSettings(settings)
  return listColorThemePresets(normalized).find((preset) => preset.id === normalized.activePresetId) || COLOR_THEME_BUILTIN_PRESETS[0]
}

export function parseColorThemePresetImport(jsonText: string, idFactory: () => string): ColorThemePreset[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (_) {
    throw new Error('导入失败：JSON 格式不正确')
  }

  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as any).presets)
      ? (parsed as any).presets
      : [parsed]

  if (!source.length) throw new Error('导入失败：没有找到配色预设')
  return source.map((item: unknown, index: number) => normalizeColorThemePreset(item, `imported-${idFactory()}-${index + 1}`))
}

// ============================================================
// 配色草稿：设置页的未保存编辑层。
// 草稿是一份完整的预设视图（内置 + 导入 + 草稿新增），界面实时预览草稿；
// 未保存状态与保存都以「单个预设」为单位：materializeColorThemePreset 只物化选中的预设
// （内置改动生成副本、导入原地更新、草稿新增正式落盘），其他预设的修改各自留在草稿里。
// ============================================================

export type ColorThemeDraft = {
  activePresetId: string
  presets: ColorThemePreset[]
}

export function cloneColorThemeDraft(settings: unknown): ColorThemeDraft {
  const base = normalizeColorThemeSettings(settings)
  return {
    activePresetId: base.activePresetId,
    presets: listColorThemePresets(base).map((preset) => ({ ...preset, baseColors: { ...preset.baseColors } })),
  }
}

export function colorThemePresetsEqual(a: ColorThemePreset | null | undefined, b: ColorThemePreset | null | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.id !== b.id || a.name !== b.name || a.description !== b.description || a.mode !== b.mode) return false
  return BASE_COLOR_KEYS.every((key) => a.baseColors[key] === b.baseColors[key])
}

// 未保存判定按「预设」粒度：某个预设只有在和它已保存的版本不同时才算未保存。
// 切换选中预设属于即时生效的使用行为，不影响判定。
export function isColorThemePresetDirty(settings: unknown, draft: ColorThemeDraft | null | undefined, presetId: string) {
  if (!draft) return false
  const preset = draft.presets.find((item) => item.id === presetId)
  if (!preset) return false
  const original = listColorThemePresets(normalizeColorThemeSettings(settings)).find((item) => item.id === preset.id)
  return !original || !colorThemePresetsEqual(original, preset)
}

export function resolveColorThemePreview(settings: unknown, draft: ColorThemeDraft | null | undefined): ColorThemePreset {
  if (draft) {
    const found = draft.presets.find((preset) => preset.id === draft.activePresetId)
    if (found) return found
  }
  return resolveColorThemePreset(settings)
}

export function uniqueColorThemePresetName(baseName: string, usedNames: ReadonlySet<string>) {
  const base = cleanText(baseName, 40) || '未命名配色'
  if (!usedNames.has(base)) return base
  for (let index = 2; index < 1000; index += 1) {
    const candidate = cleanText(`${base} ${index}`, 40)
    if (!usedNames.has(candidate)) return candidate
  }
  return cleanText(`${base} ${Date.now()}`, 40)
}

// 保存单个预设：只物化这个预设（内置改动生成副本、导入原地更新、草稿新增正式落盘），
// 其他预设的未保存修改原样留在草稿里，各自独立。
export function materializeColorThemePreset(
  settings: unknown,
  draft: ColorThemeDraft,
  presetId: string,
  makeId: () => string,
): { settings: ColorThemeSettings; draft: ColorThemeDraft } | null {
  const base = normalizeColorThemeSettings(settings)
  const baseList = listColorThemePresets(base)
  const target = draft.presets.find((preset) => preset.id === presetId)
  if (!target) return null
  const original = baseList.find((preset) => preset.id === target.id)
  if (original && colorThemePresetsEqual(original, target)) return null

  const nextImported = base.importedPresets.map((preset) => ({ ...preset, baseColors: { ...preset.baseColors } }))
  const usedNames = new Set<string>([
    ...COLOR_THEME_BUILTIN_PRESETS.map((preset) => preset.name),
    ...nextImported.map((preset) => preset.name),
  ])
  let savedId = target.id

  if (!original) {
    // 草稿新增：正式分配 id 落盘
    savedId = makeId()
    const name = uniqueColorThemePresetName(target.name || '未命名配色', usedNames)
    nextImported.push({ ...target, id: savedId, name })
  } else if (BUILTIN_PRESET_IDS.has(target.id)) {
    // 内置预设被修改：原版不动，改动生成副本
    savedId = makeId()
    const name = uniqueColorThemePresetName(`${target.name} 副本`, usedNames)
    nextImported.push({ ...target, id: savedId, name })
  } else {
    // 导入预设被修改：原地更新
    const index = nextImported.findIndex((preset) => preset.id === target.id)
    const name = cleanText(target.name, 40) || original.name
    nextImported[index] = { ...target, name }
  }

  const wasActive = base.activePresetId === target.id || draft.activePresetId === target.id
  const nextSettings = normalizeColorThemeSettings({
    activePresetId: wasActive ? savedId : base.activePresetId,
    importedPresets: nextImported,
  })

  // 新草稿：以保存后的设置为基底，把其他预设的未保存修改叠加回来。
  const nextDraft = cloneColorThemeDraft(nextSettings)
  for (const preset of draft.presets) {
    if (preset.id === target.id) continue
    const origin = baseList.find((item) => item.id === preset.id)
    if (origin && colorThemePresetsEqual(origin, preset)) continue
    const index = nextDraft.presets.findIndex((item) => item.id === preset.id)
    if (index >= 0) nextDraft.presets[index] = { ...preset, baseColors: { ...preset.baseColors } }
    else nextDraft.presets.push({ ...preset, baseColors: { ...preset.baseColors } })
  }
  nextDraft.activePresetId = draft.activePresetId === target.id ? savedId : draft.activePresetId

  return { settings: nextSettings, draft: nextDraft }
}
