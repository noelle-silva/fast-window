import * as React from 'react'
import { Box } from '@mui/material'
import { colorMixVar } from '../colorThemeStyles'

// 侧边栏顶部页签栏：A / B 共用同一条切换栏的边框、密度与字重。
// 这里只回答「一排页签怎么摆、选中值怎么回传」，左侧附加控件与下方内容都由调用方注入。
// 选中态是柔光胶囊：淡主色底 + 主色字，直接淡入淡出，不做滑块位移。
export type SidebarTabItem<T extends string> = { value: T; label: string }

export type SidebarTabsHeaderProps<T extends string> = {
  ariaLabel: string
  tabs: readonly SidebarTabItem<T>[]
  value: T
  onChange: (value: T) => void
  leading?: React.ReactNode
}

const HEADER_SX = {
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  borderBottom: '1px solid',
  borderColor: 'divider',
}

const TAB_LIST_SX = {
  display: 'flex',
  flex: 1,
  minWidth: 0,
  gap: '2px',
  px: 0.75,
  py: 0.5,
}

export function SidebarTabsHeader<T extends string>(props: SidebarTabsHeaderProps<T>) {
  const { ariaLabel, tabs, value, onChange, leading } = props
  const buttonRefs = React.useRef<Array<HTMLElement | null>>([])

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

  return (
    <Box sx={HEADER_SX}>
      {leading}

      <Box role="tablist" aria-label={ariaLabel} sx={TAB_LIST_SX}>
        {tabs.map((item, index) => {
          const selected = item.value === value
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
              sx={{
                flex: 1,
                minWidth: 0,
                height: 26,
                border: 0,
                p: 0,
                borderRadius: '8px',
                bgcolor: selected ? colorMixVar('--studio-primary', 12) : 'transparent',
                color: selected ? 'primary.main' : 'text.secondary',
                font: 'inherit',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'color .18s ease, background-color .18s ease',
                '&:hover': { bgcolor: colorMixVar('--studio-primary', selected ? 12 : 5) },
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
              }}
            >
              {item.label}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
