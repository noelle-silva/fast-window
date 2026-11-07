import * as React from 'react'
import { Box, Stack, Tab, Tabs, Typography } from '@mui/material'
import type { CategoryEditorCategory } from './categoryEditorTypes'

const tabBarSx = {
  minHeight: 40,
  p: 0.5,
  borderRadius: 2.5,
  bgcolor: 'var(--studio-paper-muted)',
  boxShadow: 'inset 0 0 0 1px var(--studio-card-border)',
  '& .MuiTabs-indicator': { display: 'none' },
  '& .MuiTabs-flexContainer': { gap: 4 },
  '& .MuiTab-root': {
    minHeight: 34,
    minWidth: 0,
    px: 1,
    borderRadius: 2,
    textTransform: 'none',
    fontSize: 13,
    fontWeight: 800,
    color: 'var(--studio-text-secondary)',
    transition: 'background-color .18s ease, color .18s ease',
  },
  '& .MuiTab-root:hover': { bgcolor: 'var(--studio-button-hover-subtle)' },
  '& .MuiTab-root.Mui-selected': {
    color: 'var(--studio-button-text)',
    bgcolor: 'var(--studio-primary)',
    boxShadow: 'var(--studio-shadow-strong)',
  },
  '& .MuiTab-root.Mui-selected:hover': { bgcolor: 'var(--studio-primary-hover)' },
} as const

/**
 * 分类切换栏：编辑器里固定不滚动的一层，下面跟一行当前分类说明。
 * attentionIds 用来标记需要处理但不方便自动跳过去的分类（例如待裁剪的头像）。
 */
export function CategoryEditorTabBar<Id extends string>(props: {
  categories: readonly CategoryEditorCategory<Id>[]
  value: Id
  onChange: (next: Id) => void
  ariaLabel: string
  tabId: (categoryId: Id) => string
  panelId: (categoryId: Id) => string
  attentionIds?: Id[]
}) {
  const { categories, value, onChange, ariaLabel, tabId, panelId, attentionIds } = props
  const attention = new Set<Id>(attentionIds || [])
  const active = categories.find((item) => item.id === value) || categories[0]

  return (
    <Box sx={{ flexShrink: 0 }}>
      <Tabs
        value={value}
        onChange={(_event, next) => onChange(next as Id)}
        variant="fullWidth"
        aria-label={ariaLabel}
        sx={tabBarSx}
      >
        {categories.map((item) => {
          const Icon = item.icon
          return (
            <Tab
              key={item.id}
              value={item.id}
              id={tabId(item.id)}
              aria-controls={panelId(item.id)}
              disableRipple
              label={
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center' }}>
                    <Icon sx={{ fontSize: 16 }} />
                  </Box>
                  <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
                    {item.label}
                  </Box>
                  {attention.has(item.id) ? (
                    <Box
                      component="span"
                      aria-label="有未处理的内容"
                      sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }}
                    />
                  ) : null}
                </Stack>
              }
            />
          )
        })}
      </Tabs>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, px: 0.5, minHeight: 18 }}>
        {active.hint}
      </Typography>
    </Box>
  )
}
