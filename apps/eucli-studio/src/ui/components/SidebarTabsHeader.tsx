import * as React from 'react'
import { Box, Tab, Tabs } from '@mui/material'

// 侧边栏顶部页签栏：A / B 共用同一条切换栏的边框、密度与字重。
// 这里只回答「一排页签怎么摆、选中值怎么回传」，左侧附加控件与下方内容都由调用方注入。
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

const TABS_SX = { minHeight: 34, flex: 1, minWidth: 0 }

const TAB_SX = { minWidth: 0, minHeight: 34, px: 0.5, fontSize: 12, fontWeight: 900 }

export function SidebarTabsHeader<T extends string>(props: SidebarTabsHeaderProps<T>) {
  const { ariaLabel, tabs, value, onChange, leading } = props

  return (
    <Box sx={HEADER_SX}>
      {leading}

      <Tabs
        value={value}
        onChange={(_event, next: T) => onChange(next)}
        variant="fullWidth"
        aria-label={ariaLabel}
        sx={TABS_SX}
      >
        {tabs.map((item) => (
          <Tab key={item.value} value={item.value} label={item.label} sx={TAB_SX} />
        ))}
      </Tabs>
    </Box>
  )
}
