import * as React from 'react'
import { Box, CssBaseline, GlobalStyles, ThemeProvider, type Theme } from '@mui/material'
import type { ColorThemeColors } from '../../domain/colorTheme'
import type { WallpaperPreset } from '../../domain/wallpaper'
import { useRenderProbe } from '../../diagnostics/renderProbe'
import { createChatGlobalStyles } from '../globalStyles'
import { ThemeColorsProvider } from '../hooks/useThemeColors'
import { colorMixVar } from '../colorThemeStyles'

export type ShellFrameProps = {
  theme: Theme
  colorThemeColors: ColorThemeColors
  transparentChatBg: boolean
  bgAlpha: number
  chatBgBlur: number
  chatFontSize: number
  chatFontFamily: string
  chatLetterSpacing: number
  chatLineHeight: number
  activeWallpaper: WallpaperPreset | null
  activeWallpaperSrc: string
  children: React.ReactNode
}

// 壳层根：主题、全局样式、壁纸与页面骨架。
// 它订阅的是真正的全局变化；页面内部状态不应穿透到这里。
export const ShellFrame = React.memo(function ShellFrame(props: ShellFrameProps) {
  useRenderProbe('shell')

  const {
    theme,
    colorThemeColors,
    transparentChatBg,
    bgAlpha,
    chatBgBlur,
    chatFontSize,
    chatFontFamily,
    chatLetterSpacing,
    chatLineHeight,
    activeWallpaper,
    activeWallpaperSrc,
    children,
  } = props

  const globalStyles = React.useMemo(
    () => createChatGlobalStyles({
      colorThemeColors,
      transparentChatBg,
      bgAlpha,
      chatBgBlur,
      chatFontSize,
      chatFontFamily,
      chatLetterSpacing,
      chatLineHeight,
    }),
    [
      colorThemeColors,
      transparentChatBg,
      bgAlpha,
      chatBgBlur,
      chatFontSize,
      chatFontFamily,
      chatLetterSpacing,
      chatLineHeight,
    ],
  )

  return (
    <ThemeProvider theme={theme}>
      <ThemeColorsProvider colors={colorThemeColors}>
        <CssBaseline />
        <GlobalStyles styles={globalStyles} />

        <Box
          sx={{
            height: '100%',
            minWidth: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            isolation: 'isolate',
            color: 'var(--studio-text-primary)',
            background: 'var(--studio-app-background)',
          }}
        >
          {activeWallpaper ? (
            <Box sx={{ position: 'absolute', inset: 0, zIndex: -2, pointerEvents: 'none', overflow: 'hidden' }}>
              {activeWallpaperSrc ? (
                <Box
                  component="img"
                  src={activeWallpaperSrc}
                  alt=""
                  sx={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: `${activeWallpaper.view.x}% ${activeWallpaper.view.y}%`,
                    transform: `scale(${activeWallpaper.view.scale * 1.05})`,
                    transformOrigin: `${activeWallpaper.view.x}% ${activeWallpaper.view.y}%`,
                    display: 'block',
                  }}
                />
              ) : null}
            </Box>
          ) : null}
          {activeWallpaper ? (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                zIndex: -1,
                pointerEvents: 'none',
                bgcolor: colorMixVar('--studio-canvas', Math.max(1, bgAlpha * 100)),
                backdropFilter: chatBgBlur > 0 ? `blur(${chatBgBlur}px)` : 'none',
                WebkitBackdropFilter: chatBgBlur > 0 ? `blur(${chatBgBlur}px)` : 'none',
              }}
            />
          ) : null}
          {children}
        </Box>
      </ThemeColorsProvider>
    </ThemeProvider>
  )
})
