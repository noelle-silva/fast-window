import * as React from 'react'
import { CssBaseline, GlobalStyles, ThemeProvider } from '@mui/material'
import { COLOR_THEME_BUILTIN_PRESETS, getColorThemeColors } from '../src/domain/colorTheme'
import {
  CHAT_FONT_SIZE_DEFAULT,
  CHAT_LETTER_SPACING_DEFAULT,
  CHAT_LINE_HEIGHT_DEFAULT,
} from '../src/domain/chatFont'
import { createStudioMuiTheme } from '../src/ui/colorThemeStyles'
import { createChatGlobalStyles } from '../src/ui/globalStyles'

// 基准页面复用应用真实主题与全局样式，保证测量到的排版、字体、表格包装一致。
// 这里只装配默认配色，不读取任何用户设置。
const preset = COLOR_THEME_BUILTIN_PRESETS[0]
const colors = getColorThemeColors(preset)
const theme = createStudioMuiTheme(preset.mode, colors)
const globalStyles = createChatGlobalStyles({
  colorThemeColors: colors,
  transparentChatBg: false,
  bgAlpha: 1,
  chatBgBlur: 0,
  chatFontSize: CHAT_FONT_SIZE_DEFAULT,
  chatFontFamily: '',
  chatLetterSpacing: CHAT_LETTER_SPACING_DEFAULT,
  chatLineHeight: CHAT_LINE_HEIGHT_DEFAULT,
})

export function BenchTheme(props: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={globalStyles} />
      {props.children}
    </ThemeProvider>
  )
}

export { theme as benchTheme }
