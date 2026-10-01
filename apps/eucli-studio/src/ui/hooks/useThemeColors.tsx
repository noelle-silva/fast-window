import * as React from 'react'
import type { ColorThemeColors } from '../../domain/colorTheme'

export type ThemeColors = ColorThemeColors

// 主题颜色的唯一 JS 入口。
// 上层在解析出预设后，用同一个派生结果同时注入 CSS 变量与这里，
// 保证「样式里的颜色」和「JS 里读到的颜色」来自同一事实源，且随主题切换同步更新。
const ThemeColorsContext = React.createContext<ColorThemeColors | null>(null)

export function ThemeColorsProvider(props: { colors: ColorThemeColors; children: React.ReactNode }) {
  return <ThemeColorsContext.Provider value={props.colors}>{props.children}</ThemeColorsContext.Provider>
}

export function useThemeColors(): ColorThemeColors {
  const colors = React.useContext(ThemeColorsContext)
  if (!colors) throw new Error('useThemeColors 必须在 ThemeColorsProvider 内使用')
  return colors
}
