import type { SxProps, Theme } from '@mui/material'
import { colorMixVar } from '../colorThemeStyles'
import type { SidebarTabsVariant } from '../../domain/sidebarTabs'

// 顶部切换栏的样式清单：每种变体只回答「容器长什么样、页签长什么样、要不要滑块」。
// 组件本体负责测量、键盘与读屏，样式全部从这里取，避免散落在 JSX 里。

/** 需要一条可滑动指示块的变体。 */
export function tabsVariantUsesThumb(variant: SidebarTabsVariant): boolean {
  return variant === 'pill' || variant === 'underline'
}

/** 页签前面要带小图标的变体。 */
export function tabsVariantUsesIcon(variant: SidebarTabsVariant): boolean {
  return variant === 'icon'
}

/** 选中态用「填充底色 + 白字」，需要给文字单独一层。 */
export function tabsVariantUsesLabelLayer(variant: SidebarTabsVariant): boolean {
  return variant === 'fill'
}

const BASE_LIST: SxProps<Theme> = {
  position: 'relative',
  display: 'flex',
  flex: 1,
  minWidth: 0,
  gap: '2px',
  px: 0.75,
  py: 0.5,
}

const BASE_TAB: SxProps<Theme> = {
  position: 'relative',
  zIndex: 1,
  flex: 1,
  minWidth: 0,
  height: 26,
  border: 0,
  p: 0,
  borderRadius: '8px',
  background: 'transparent',
  color: 'text.secondary',
  font: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '5px',
  transition: 'color .18s ease, background-color .18s ease, box-shadow .22s ease, transform .18s ease',
  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
}

// 括号夹持的上下两条短线：用 currentColor 跟着文字色走，省一份颜色映射。
function bracketEdges(): Record<string, unknown> {
  return {
    '&::before, &::after': {
      content: '""',
      position: 'absolute',
      left: '22%',
      right: '22%',
      height: 2,
      borderRadius: 2,
      backgroundColor: 'currentColor',
    },
    '&::before': { top: 4 },
    '&::after': { bottom: 4 },
  }
}

export function resolveTabsListSx(variant: SidebarTabsVariant): SxProps<Theme> {
  switch (variant) {
    case 'pill':
      return { ...BASE_LIST, gap: '2px', p: '3px', borderRadius: '10px', bgcolor: colorMixVar('--studio-primary', 9) }
    case 'underline':
      return { ...BASE_LIST, pt: '3px', pb: '5px' }
    case 'segmented':
      return { ...BASE_LIST, gap: '2px', p: '2px', borderRadius: '9px', bgcolor: colorMixVar('--studio-primary', 6) }
    case 'rail':
      return { ...BASE_LIST, gap: '1px' }
    case 'dot':
      return { ...BASE_LIST, pb: '6px' }
    case 'fill':
      return { ...BASE_LIST, gap: '0px', borderRadius: '8px', overflow: 'hidden', bgcolor: colorMixVar('--studio-primary', 6) }
    case 'icon':
      return { ...BASE_LIST, gap: '2px' }
    case 'soft':
    case 'bracket':
    case 'lift':
    case 'mui':
    default:
      return BASE_LIST
  }
}

export function resolveTabSx(variant: SidebarTabsVariant, selected: boolean): SxProps<Theme> {
  const primary = colorMixVar('--studio-primary', 12)
  const primaryHover = colorMixVar('--studio-primary', selected ? 12 : 5)

  switch (variant) {
    case 'pill':
      return { ...BASE_TAB, borderRadius: '8px', color: selected ? '#fff' : 'text.secondary' }

    case 'underline':
      return { ...BASE_TAB, color: selected ? 'primary.main' : 'text.secondary' }

    case 'segmented':
      return {
        ...BASE_TAB,
        borderRadius: '7px',
        color: selected ? 'text.primary' : 'text.secondary',
        bgcolor: selected ? 'background.paper' : 'transparent',
        boxShadow: selected ? '0 1px 3px rgba(15,23,42,.12), 0 0 0 1px rgba(15,23,42,.04)' : 'none',
        '&:hover': { bgcolor: selected ? 'background.paper' : 'action.hover' },
      }

    case 'bracket':
      return { ...BASE_TAB, color: selected ? 'primary.main' : 'text.secondary', ...(selected ? bracketEdges() : {}) }

    case 'rail':
      return {
        ...BASE_TAB,
        justifyContent: 'flex-start',
        pl: '9px',
        borderRadius: '6px',
        color: selected ? 'text.primary' : 'text.secondary',
        bgcolor: selected ? colorMixVar('--studio-primary', 7) : 'transparent',
        '&:hover': { bgcolor: primaryHover },
        '&::before': selected
          ? { content: '""', position: 'absolute', left: 0, top: 5, bottom: 5, width: 3, borderRadius: 3, background: 'primary.main' }
          : undefined,
      }

    case 'dot':
      return {
        ...BASE_TAB,
        color: selected ? 'text.primary' : 'text.secondary',
        '&::after': {
          content: '""',
          position: 'absolute',
          left: '50%',
          bottom: -1,
          width: 4,
          height: 4,
          borderRadius: '50%',
          background: 'primary.main',
          transform: selected ? 'translateX(-50%) scale(1)' : 'translateX(-50%) scale(0)',
          transition: 'transform .22s cubic-bezier(.34,1.56,.64,1)',
        },
      }

    case 'lift':
      return {
        ...BASE_TAB,
        color: selected ? 'text.primary' : 'text.secondary',
        bgcolor: selected ? 'background.paper' : 'transparent',
        transform: selected ? 'translateY(-1px)' : 'none',
        boxShadow: selected
          ? `0 4px 10px rgba(15,23,42,.1), 0 0 0 1px ${colorMixVar('--studio-primary', 22)}`
          : 'none',
        '&:hover': { bgcolor: selected ? 'background.paper' : primaryHover },
      }

    case 'fill':
      return {
        ...BASE_TAB,
        borderRadius: 0,
        zIndex: 0,
        color: selected ? '#fff' : 'text.secondary',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '0 auto 0 0',
          width: selected ? '100%' : 0,
          background: 'primary.main',
          transition: 'width .28s cubic-bezier(.4,0,.2,1)',
          zIndex: -1,
        },
      }

    case 'icon':
      return {
        ...BASE_TAB,
        color: selected ? 'primary.main' : 'text.disabled',
        '& svg': { transition: 'transform .2s ease', transform: selected ? 'scale(1.08)' : 'none' },
        '&::before': selected
          ? {
              content: '""',
              position: 'absolute',
              inset: 2,
              borderRadius: '8px',
              background: `radial-gradient(circle at 50% 120%, ${colorMixVar('--studio-primary', 22)}, transparent 70%)`,
            }
          : undefined,
      }

    case 'soft':
    case 'mui':
    default:
      return {
        ...BASE_TAB,
        color: selected ? 'primary.main' : 'text.secondary',
        bgcolor: selected ? primary : 'transparent',
        '&:hover': { bgcolor: primaryHover },
      }
  }
}

/** 滑块（pill 药丸块 / underline 细线）的样式。 */
export function resolveThumbSx(variant: SidebarTabsVariant): SxProps<Theme> {
  if (variant === 'pill') {
    return {
      position: 'absolute',
      top: '3px',
      bottom: '3px',
      left: 0,
      width: 0,
      borderRadius: '8px',
      background: 'primary.main',
      boxShadow: `0 3px 8px ${colorMixVar('--studio-primary', 32)}`,
      transition: 'transform .3s cubic-bezier(.4,0,.2,1), width .3s cubic-bezier(.4,0,.2,1)',
      pointerEvents: 'none',
    }
  }
  return {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 2,
    width: 0,
    borderRadius: 2,
    background: 'primary.main',
    transition: 'transform .3s cubic-bezier(.4,0,.2,1), width .3s cubic-bezier(.4,0,.2,1)',
    pointerEvents: 'none',
  }
}
