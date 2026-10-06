import type { BaseColors, ColorThemeColors, ColorThemeMode } from './colorTheme'
import { formatCss, formatHsla, formatRgba, parseColor } from './cssColor'
import { interpolate, wcagContrast } from 'culori'

// System 角色固定使用紫色调；其文字色按底色对比度自适应，保证暗色主题下依然可读。
// 这是唯一的固定语义色：System 角色在全部主题下都保持紫色身份，故不参与基础色派生。
const SYSTEM_ACCENT = '#7c3aed'

// ============================================================
// 颜色运算工具：混合、透明度、明暗调整
// ============================================================

/** 混合两个颜色，ratio 为第二个颜色的占比（0~1） */
function mixColors(color1: string, color2: string, ratio: number): string {
  const parsed1 = parseColor(color1)
  const parsed2 = parseColor(color2)
  if (!parsed1 || !parsed2) return color1

  const mix = interpolate([parsed1, parsed2], 'oklch')
  const result = mix(ratio)
  return formatCss(result)
}

/** 调整颜色透明度 */
function withAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color)
  if (!parsed) return color
  return formatCss({ ...parsed, alpha })
}

/** 加亮颜色（增加明度） */
function lighten(color: string, amount: number): string {
  const parsed = parseColor(color)
  if (!parsed) return color
  const hsl = formatHsla(parsed)
  if (!hsl) return color
  const newL = Math.min(hsl.l + amount, 1)
  return formatCss({ mode: 'hsl', h: hsl.h, s: hsl.s, l: newL, alpha: hsl.a })
}

/** 加暗颜色（降低明度） */
function darken(color: string, amount: number): string {
  const parsed = parseColor(color)
  if (!parsed) return color
  const hsl = formatHsla(parsed)
  if (!hsl) return color
  const newL = Math.max(hsl.l - amount, 0)
  return formatCss({ mode: 'hsl', h: hsl.h, s: hsl.s, l: newL, alpha: hsl.a })
}

/** 格式化为 CSS box-shadow 值（用于 focus/shadowSoft/shadowStrong） */
function formatAsShadow(color: string, opacity: number, blur = 12, spread = 0, offsetX = 0, offsetY = 2): string {
  const rgba = formatRgba({ ...(parseColor(color) ?? { mode: 'rgb', r: 0, g: 0, b: 0 }), alpha: opacity })
  if (!rgba) return `${offsetX}px ${offsetY}px ${blur}px ${spread}px rgba(0,0,0,${opacity})`
  return `${offsetX}px ${offsetY}px ${blur}px ${spread}px rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`
}

/** 在给定底色上挑选可读的前景色（深底用白、浅底用黑） */
function pickReadableOn(background: string, light = '#ffffff', dark = '#0f172a'): string {
  return (wcagContrast(light, background) ?? 0) >= (wcagContrast(dark, background) ?? 0) ? light : dark
}

// ============================================================
// 派生规则：从 10 个基础色涌现完整主题颜色表
// ============================================================

export function deriveFullColorTheme(base: BaseColors, mode: ColorThemeMode): ColorThemeColors {
  const isDark = mode === 'dark'

  // 检测对比度并在不足时自动调整（避免文字不可读）
  const ensureContrast = (fg: string, bg: string, minRatio = 4.5): string => {
    const contrast = wcagContrast(fg, bg)
    if (contrast && contrast >= minRatio) return fg
    // 对比度不足，自动加亮或加暗
    return isDark ? lighten(fg, 0.2) : darken(fg, 0.2)
  }

  return {
    // 背景层级
    canvas: base.background,
    appBackground: base.background,
    paper: base.surface,
    paperMuted: isDark ? mixColors(base.surface, '#000', 0.08) : mixColors(base.surface, '#fff', 0.15), // light模式更接近白
    paperStrong: mixColors(base.surface, base.text, 0.03), // 降低混合比例
    
    // 特定表面
    topbar: mixColors(base.surface, base.background, 0.5), // 增加background比例
    composer: mixColors(base.surface, base.background, 0.1), // 微调，主要保持surface
    codeBackground: base.surfaceCode,

    // 输入框
    field: withAlpha(mixColors(base.surface, base.text, 0.04), 0.86), // 降低混合比例，调整透明度
    fieldHover: withAlpha(mixColors(base.surface, base.text, 0.02), 0.96),
    fieldFocus: withAlpha(mixColors(base.surface, base.primary, 0.08), 0.98),

    // 强调色
    primary: base.primary,
    primaryHover: mixColors(base.primary, isDark ? '#fff' : '#000', 0.18), // 增加混合比例
    primarySoft: withAlpha(base.primary, 0.12),
    secondary: base.secondary,
    secondarySoft: withAlpha(base.secondary, 0.13),

    // 文字
    textPrimary: ensureContrast(base.text, base.background),
    textSecondary: withAlpha(base.text, 0.88), // 调整为0.88接近原版
    // 代码块文字随「代码块表面」的实际明暗自适应：表面是浅色就用深字，表面是深色就用白字。
    // 这样代码块表面无论被配成什么颜色，文字都必然可读，不再依赖主题的明暗模式。
    codeText: pickReadableOn(base.surfaceCode),

    // 边框/光圈
    border: base.border,
    focus: formatAsShadow(base.primary, 0.10, 30, 0, 0, 12), // 调整参数接近原版

    // 阴影
    shadowSoft: formatAsShadow(base.text, 0.065, 26, 0, 0, 10), // 调整opacity
    shadowStrong: formatAsShadow(base.text, 0.18, 70, 0, 0, 24), // 调整参数

    // 状态色（基础）
    success: base.success,
    warning: base.warning,
    danger: base.danger,

    // 状态色（背景）
    successBg: withAlpha(base.success, 0.12),
    successBgStrong: withAlpha(base.success, 0.26),
    dangerBg: withAlpha(base.danger, 0.12),
    warningBg: withAlpha(base.warning, 0.12),

    // 状态色（文字）
    successText: isDark ? lighten(base.success, 0.15) : darken(base.success, 0.1),
    dangerText: isDark ? lighten(base.danger, 0.15) : darken(base.danger, 0.1),
    warningText: isDark ? lighten(base.warning, 0.15) : darken(base.warning, 0.1),

    // System 角色专用：文字色按底色对比度自适应，暗色主题下不至于不可读。
    systemBg: withAlpha(SYSTEM_ACCENT, 0.08),
    systemBorder: withAlpha(SYSTEM_ACCENT, 0.42),
    systemText: ensureContrast(isDark ? lighten(SYSTEM_ACCENT, 0.2) : darken(SYSTEM_ACCENT, 0.3), base.surface),

    // 树形图专用
    treeNodeBg: withAlpha(base.surface, 0.72),
    treeNodeBorder: withAlpha(base.text, 0.12),
    treeEdge: withAlpha(base.text, 0.16),
    treeEdgeHighlight: withAlpha(base.success, 0.85),

    // 通用组件
    divider: withAlpha(base.text, 0.10),
    toolbarBg: withAlpha(base.surface, 0.72),
    toolbarBorder: withAlpha(base.text, 0.12),
    overlay: withAlpha(base.text, 0.35),
    scrollbarTrack: withAlpha(base.text, 0.04),
    scrollbarThumb: withAlpha(base.text, 0.18),

    // 输入框与表单
    inputBorder: withAlpha(base.text, 0.16),
    inputBg: withAlpha(base.surface, 0.82),
    buttonText: pickReadableOn(base.primary),
    buttonHoverSubtle: withAlpha(base.text, 0.10),

    // 卡片
    cardBorder: withAlpha(base.text, 0.12),
    cardBg: withAlpha(base.surface, 0.58),

    // 文本层级
    textTertiary: withAlpha(base.text, 0.68),

    // Toast 通知：深色浮层统一从基础色派生，跟随主题而不是写死。
    toastBg: withAlpha(base.text, 0.94),
    toastText: pickReadableOn(base.text),
    toastBorder: withAlpha(base.text, 0.24),
    toastShadow: formatAsShadow(base.text, 0.24, 44, 0, 0, 18),
    successBgDark: withAlpha(base.success, 0.94),
    successTextLight: pickReadableOn(base.success),
    successBorderDark: withAlpha(darken(base.success, 0.12), 0.34),
    successShadow: formatAsShadow(darken(base.success, 0.12), 0.28, 44, 0, 0, 18),
    errorBgDark: withAlpha(base.danger, 0.94),
    errorTextLight: pickReadableOn(base.danger),
    errorBorderDark: withAlpha(darken(base.danger, 0.12), 0.36),
    errorShadow: formatAsShadow(darken(base.danger, 0.12), 0.28, 44, 0, 0, 18),

    // Mermaid 浮动操作按钮
    mermaidActionBg: withAlpha(isDark ? base.surface : '#ffffff', isDark ? 0.75 : 0.88),
    mermaidActionBgHover: withAlpha(isDark ? base.surface : '#ffffff', isDark ? 0.85 : 0.96),
    mermaidActionText: withAlpha(base.text, 0.72),
    mermaidActionTextHover: withAlpha(base.text, 0.88),
    mermaidActionShadow: formatAsShadow(base.text, 0.10, 20, 0, 0, 8),
  }
}
