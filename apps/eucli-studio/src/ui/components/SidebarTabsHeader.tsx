import * as React from 'react'
import { Box, Tab, Tabs } from '@mui/material'
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded'
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined'
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded'
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined'
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'
import WorkspacesOutlinedIcon from '@mui/icons-material/WorkspacesOutlined'
import { normalizeSidebarTabsVariant, type SidebarTabsVariant } from '../../domain/sidebarTabs'
import {
  resolveTabSx,
  resolveTabsListSx,
  resolveThumbSx,
  tabsVariantUsesIcon,
  tabsVariantUsesLabelLayer,
  tabsVariantUsesThumb,
} from './sidebarTabsSx'

// 侧边栏顶部页签栏：A / B 共用同一条切换栏，样式由各自配置决定。
// 这里只回答「一排页签怎么摆、选中值怎么回传、键盘怎么走」，左侧附加控件与下方内容都由调用方注入。
export type SidebarTabItem<T extends string> = { value: T; label: string }

export type SidebarTabsHeaderProps<T extends string> = {
  ariaLabel: string
  tabs: readonly SidebarTabItem<T>[]
  value: T
  onChange: (value: T) => void
  leading?: React.ReactNode
  /** 外观样式；缺省用默认样式。 */
  variant?: SidebarTabsVariant
}

// 顶部栏与下方内容之间不做分割线：靠留白与页签自身的底色分层。
const HEADER_SX = {
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
}

// 图标联动的图标：按文案关键字匹配，认不出就用一个中性圆点。
function iconForLabel(label: string): React.ElementType {
  const text = String(label || '')
  if (text.includes('历史')) return HistoryRoundedIcon
  if (text.includes('角色')) return PersonOutlinedIcon
  if (text.includes('工作区')) return WorkspacesOutlinedIcon
  if (text.includes('收藏')) return StarBorderRoundedIcon
  if (text.includes('桌面')) return DesktopWindowsOutlinedIcon
  if (text.includes('会话')) return ChatBubbleOutlineRoundedIcon
  return RadioButtonUncheckedRoundedIcon
}

export function SidebarTabsHeader<T extends string>(props: SidebarTabsHeaderProps<T>) {
  const { ariaLabel, tabs, value, onChange, leading } = props
  const variant = normalizeSidebarTabsVariant(props.variant)
  const buttonRefs = React.useRef<Array<HTMLElement | null>>([])
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const usesThumb = tabsVariantUsesThumb(variant)
  const usesIcon = tabsVariantUsesIcon(variant)
  const usesLabelLayer = tabsVariantUsesLabelLayer(variant)
  const [thumb, setThumb] = React.useState({ left: 0, width: 0 })

  // 滑块位置由 DOM 实测得出：字宽、段数、侧栏宽度变化都靠这一次测量跟上。
  const measure = React.useCallback(() => {
    if (!usesThumb) return
    const list = listRef.current
    if (!list) return
    const index = tabs.findIndex((item) => item.value === value)
    const node = buttonRefs.current[index]
    if (!node) return
    const padLeft = parseFloat(getComputedStyle(list).paddingLeft || '0') || 0
    setThumb({ left: node.offsetLeft - padLeft, width: node.offsetWidth })
  }, [tabs, usesThumb, value])

  React.useLayoutEffect(() => {
    measure()
  }, [measure])

  React.useEffect(() => {
    if (!usesThumb) return
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(list)
    return () => observer.disconnect()
  }, [measure, usesThumb])

  // 键盘走标准页签模式：左右循环、Home / End 到两端，焦点跟着选中项走。
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const key = event.key
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
    event.preventDefault()
    const count = tabs.length
    if (!count) return
    let next = index
    if (key === 'ArrowLeft') next = (index - 1 + count) % count
    else if (key === 'ArrowRight') next = (index + 1) % count
    else if (key === 'Home') next = 0
    else next = count - 1
    onChange(tabs[next].value)
    buttonRefs.current[next]?.focus()
  }

  // 最初的经典样式：直接交给 MUI 页签，保持原样。
  if (variant === 'mui') {
    return (
      <Box sx={HEADER_SX}>
        {leading}
        <Tabs
          value={value}
          onChange={(_event, next: T) => onChange(next)}
          variant="fullWidth"
          aria-label={ariaLabel}
          sx={{ minHeight: 34, flex: 1, minWidth: 0 }}
        >
          {tabs.map((item) => (
            <Tab
              key={item.value}
              value={item.value}
              label={item.label}
              sx={{ minWidth: 0, minHeight: 34, px: 0.5, fontSize: 12, fontWeight: 900 }}
            />
          ))}
        </Tabs>
      </Box>
    )
  }

  return (
    <Box sx={HEADER_SX}>
      {leading}

      <Box ref={listRef} role="tablist" aria-label={ariaLabel} sx={resolveTabsListSx(variant)}>
        {usesThumb ? (
          <Box
            aria-hidden="true"
            sx={{
              ...(resolveThumbSx(variant) as Record<string, unknown>),
              width: `${thumb.width}px`,
              transform: `translateX(${thumb.left}px)`,
            }}
          />
        ) : null}

        {tabs.map((item, index) => {
          const selected = item.value === value
          const Icon = usesIcon ? iconForLabel(item.label) : null
          const label = usesLabelLayer ? (
            <Box component="span" sx={{ position: 'relative', zIndex: 1 }}>
              {item.label}
            </Box>
          ) : (
            item.label
          )
          return (
            <Box
              key={item.value}
              ref={(node: HTMLElement | null) => {
                buttonRefs.current[index] = node
              }}
              component="button"
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.value)}
              onKeyDown={(event: React.KeyboardEvent) => handleKeyDown(event, index)}
              sx={resolveTabSx(variant, selected)}
            >
              {Icon ? <Icon sx={{ fontSize: 13 }} /> : null}
              {label}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
