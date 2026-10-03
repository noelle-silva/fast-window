import { createTheme } from '@mui/material'
import type { ColorThemeColors, ColorThemeMode } from '../domain/colorTheme'
import type { PlaceholderDiagramColors } from '../render/placeholderDiagram'
import { OVERLAY_TRANSITION_DURATION } from './overlayTransition'

export function colorThemeCssVariables(colors: ColorThemeColors) {
  return {
    '--studio-canvas': colors.canvas,
    '--studio-paper': colors.paper,
    '--studio-paper-muted': colors.paperMuted,
    '--studio-paper-strong': colors.paperStrong,
    '--studio-app-background': colors.appBackground,
    '--studio-topbar': colors.topbar,
    '--studio-composer': colors.composer,
    '--studio-field': colors.field,
    '--studio-settings-surface': colors.field,
    '--studio-settings-surface-shadow': colors.shadowStrong,
    '--studio-field-hover': colors.fieldHover,
    '--studio-field-focus': colors.fieldFocus,
    '--studio-primary': colors.primary,
    '--studio-primary-hover': colors.primaryHover,
    '--studio-primary-soft': colors.primarySoft,
    '--studio-secondary': colors.secondary,
    '--studio-secondary-soft': colors.secondarySoft,
    '--studio-text-primary': colors.textPrimary,
    '--studio-text-secondary': colors.textSecondary,
    '--studio-border': colors.border,
    '--studio-shadow-soft': colors.shadowSoft,
    '--studio-shadow-strong': colors.shadowStrong,
    '--studio-focus': colors.focus,
    '--studio-code-background': colors.codeBackground,
    '--studio-code-text': colors.codeText,
    '--studio-success': colors.success,
    '--studio-danger': colors.danger,
    '--studio-warning': colors.warning,
    '--studio-success-bg': colors.successBg,
    '--studio-success-bg-strong': colors.successBgStrong,
    '--studio-danger-bg': colors.dangerBg,
    '--studio-warning-bg': colors.warningBg,
    '--studio-success-text': colors.successText,
    '--studio-danger-text': colors.dangerText,
    '--studio-warning-text': colors.warningText,
    '--studio-system-bg': colors.systemBg,
    '--studio-system-border': colors.systemBorder,
    '--studio-system-text': colors.systemText,
    '--studio-tree-node-bg': colors.treeNodeBg,
    '--studio-tree-node-border': colors.treeNodeBorder,
    '--studio-tree-edge': colors.treeEdge,
    '--studio-tree-edge-highlight': colors.treeEdgeHighlight,
    '--studio-divider': colors.divider,
    '--studio-toolbar-bg': colors.toolbarBg,
    '--studio-toolbar-border': colors.toolbarBorder,
    '--studio-overlay': colors.overlay,
    '--studio-scrollbar-track': colors.scrollbarTrack,
    '--studio-scrollbar-thumb': colors.scrollbarThumb,
    '--studio-input-border': colors.inputBorder,
    '--studio-input-bg': colors.inputBg,
    '--studio-button-text': colors.buttonText,
    '--studio-button-hover-subtle': colors.buttonHoverSubtle,
    '--studio-card-border': colors.cardBorder,
    '--studio-card-bg': colors.cardBg,
    '--studio-text-tertiary': colors.textTertiary,
    '--studio-toast-bg': colors.toastBg,
    '--studio-toast-text': colors.toastText,
    '--studio-toast-border': colors.toastBorder,
    '--studio-toast-shadow': colors.toastShadow,
    '--studio-success-bg-dark': colors.successBgDark,
    '--studio-success-text-light': colors.successTextLight,
    '--studio-success-border-dark': colors.successBorderDark,
    '--studio-success-shadow': colors.successShadow,
    '--studio-error-bg-dark': colors.errorBgDark,
    '--studio-error-text-light': colors.errorTextLight,
    '--studio-error-border-dark': colors.errorBorderDark,
    '--studio-error-shadow': colors.errorShadow,
    // Mermaid 浮动操作按钮
    '--studio-mermaid-action-bg': colors.mermaidActionBg,
    '--studio-mermaid-action-bg-hover': colors.mermaidActionBgHover,
    '--studio-mermaid-action-text': colors.mermaidActionText,
    '--studio-mermaid-action-text-hover': colors.mermaidActionTextHover,
    '--studio-mermaid-action-shadow': colors.mermaidActionShadow,
    // Mermaid error box
    '--studio-mermaid-error-bg': colors.paper,
    '--studio-mermaid-error-border': colors.border,
    '--studio-mermaid-error-button-bg': colors.paperStrong,
    '--studio-mermaid-error-button-text': colors.textSecondary,
    '--studio-mermaid-error-title': colors.textSecondary,
    '--studio-mermaid-error-text': colors.textPrimary,
    // Tool blocks
    '--studio-tool-block-bg': colors.paperMuted,
    '--studio-tool-session-bg': colors.paper,
    '--studio-tool-session-shadow': colors.shadowStrong,
    '--studio-tool-session-mark': colors.border,
    '--studio-tool-session-title': colors.textPrimary,
    '--studio-tool-session-label': colors.textSecondary,
    '--studio-tool-session-pill-bg': colors.fieldHover,
    '--studio-tool-session-chevron': colors.textSecondary,
    '--studio-tool-glyph-bg': colors.border,
    '--studio-tool-glyph-result-bg': colors.fieldHover,
    '--studio-tool-call-id': colors.textTertiary,
    '--studio-tool-chip-bg': colors.fieldHover,
    '--studio-tool-chip-text': colors.textPrimary,
    '--studio-tool-field-label': colors.textSecondary,
    '--studio-tool-pre-bg': colors.codeBackground,
    '--studio-tool-pre-text': colors.textPrimary,
    '--studio-tool-pre-raw-bg': colors.primarySoft,
    '--studio-tool-pre-live-bg': colors.secondarySoft,
    '--studio-tool-pre-live-text': colors.textPrimary,
    '--studio-tool-meta-text': colors.textSecondary,
    '--studio-diagnostic-bg': colors.dangerBg,
    '--studio-diagnostic-title': colors.dangerText,
    '--studio-diagnostic-text': colors.dangerText,
    // Code block copy button
    '--studio-code-border': colors.border,
    '--studio-code-copy-border': colors.border,
    '--studio-code-copy-bg': colors.fieldHover,
    '--studio-code-copy-text': colors.textSecondary,
    '--studio-code-copy-hover': colors.field,
    '--studio-code-copy-active': colors.fieldFocus,
    '--studio-code-copy-focus': colors.focus,
  }
}

export function colorMixVar(cssVar: string, percent: number) {
  return `color-mix(in srgb, var(${cssVar}) ${Math.round(percent)}%, transparent)`
}

// Mermaid 依赖图（拿不到 CSS 变量，需真实色值）与主题色之间的唯一映射。
export function placeholderDiagramColors(colors: ColorThemeColors): PlaceholderDiagramColors {
  return {
    rootNodeFill: colors.primarySoft,
    rootNodeStroke: colors.primary,
    rootNodeText: colors.textPrimary,
    missingNodeFill: colors.dangerBg,
    missingNodeStroke: colors.danger,
    missingNodeText: colors.dangerText,
    cycleNodeFill: colors.warningBg,
    cycleNodeStroke: colors.warning,
    cycleNodeText: colors.warningText,
  }
}

export function createStudioMuiTheme(mode: ColorThemeMode, colors: ColorThemeColors) {
  return createTheme({
    palette: {
      mode,
      primary: { main: colors.primary },
      secondary: { main: colors.secondary },
      success: { main: colors.success },
      error: { main: colors.danger },
      warning: { main: colors.warning },
      background: {
        default: colors.appBackground,
        paper: colors.paper,
      },
      text: {
        primary: colors.textPrimary,
        secondary: colors.textSecondary,
      },
      divider: colors.border,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        'system-ui,-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Roboto,Arial,sans-serif',
    },
    components: {
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 24,
            color: 'var(--studio-text-primary)',
            background: 'var(--studio-paper)',
            boxShadow: 'var(--studio-shadow-strong)',
            backgroundImage: 'none',
            overflow: 'hidden',
            '& .MuiOutlinedInput-root': {
              borderRadius: 16,
              backgroundColor: 'var(--studio-field)',
              boxShadow: 'var(--studio-shadow-soft)',
              transition: 'background-color .16s ease, box-shadow .16s ease',
            },
            '& .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiOutlinedInput-root:hover': {
              backgroundColor: 'var(--studio-field-hover)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiOutlinedInput-root.Mui-focused': {
              backgroundColor: 'var(--studio-field-focus)',
              boxShadow: 'var(--studio-focus)',
            },
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiInputLabel-root': { fontWeight: 700, color: 'var(--studio-text-secondary)' },
            '& .MuiInputLabel-root.Mui-focused': { color: 'var(--studio-primary)' },
            '& .MuiPaper-outlined': {
              border: 0,
              borderRadius: 20,
              backgroundColor: 'var(--studio-field)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiButton-outlined': {
              border: 0,
              backgroundColor: 'var(--studio-field)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiButton-outlined:hover': {
              border: 0,
              backgroundColor: 'var(--studio-field-hover)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiChip-outlined': {
              border: 0,
              backgroundColor: 'var(--studio-paper-muted)',
              fontWeight: 800,
            },
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            padding: '20px 24px 12px',
            fontWeight: 900,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: {
            backgroundColor: 'var(--studio-paper-muted)',
            '&.MuiDialogContent-dividers': {
              borderTop: 0,
              borderBottom: 0,
            },
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            padding: '12px 24px 20px',
            backgroundColor: 'var(--studio-paper-muted)',
            gap: 8,
          },
        },
      },
      // 弹出层（Popover / Menu）过渡时长显式固定，禁用 Grow 的「自动时长」模式。
      //
      // 自动模式的退出完成信号依赖一个可被取消的内部共享计时器，同时底层过渡库的
      // 兜底计时器在该模式下被关闭；切会话等高频刷新会打断它，导致退出回调丢失、
      // 弹层模态容器永久残留并拦截全屏鼠标交互。固定时长让完成路径确定，
      // 与 DependablePopover 的「关闭后必然卸下」保障共享同一事实源。
      MuiPopover: {
        defaultProps: {
          transitionDuration: { ...OVERLAY_TRANSITION_DURATION },
        },
        styleOverrides: {
          paper: {
            borderRadius: 24,
            color: 'var(--studio-text-primary)',
            background: 'var(--studio-paper)',
            boxShadow: 'var(--studio-shadow-strong)',
            '& .MuiOutlinedInput-root': {
              borderRadius: 18,
              backgroundColor: 'var(--studio-field)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiOutlinedInput-root .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiOutlinedInput-root:hover': {
              backgroundColor: 'var(--studio-field-hover)',
              boxShadow: 'var(--studio-shadow-soft)',
            },
            '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiOutlinedInput-root.Mui-focused': {
              backgroundColor: 'var(--studio-field-focus)',
              boxShadow: 'var(--studio-focus)',
            },
            '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 0 },
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTab-root': {
              borderRadius: 16,
              minHeight: 40,
              fontWeight: 800,
            },
            '& .MuiTab-root.Mui-selected': {
              backgroundColor: 'var(--studio-primary-soft)',
            },
          },
        },
      },
      MuiMenu: {
        defaultProps: {
          transitionDuration: { ...OVERLAY_TRANSITION_DURATION },
        },
      },
    },
  })
}
