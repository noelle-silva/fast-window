import * as React from 'react'
import { Box, Stack, Tab, Tabs, Typography } from '@mui/material'
import {
  ROLE_EDITOR_CATEGORIES,
  roleEditorPanelDomId,
  roleEditorTabDomId,
  type RoleEditorCategoryId,
} from './roleEditorCategories'

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
 * attentionCategories 用来标记需要处理但不方便自动跳过去的分类（例如待裁剪的头像）。
 */
export function RoleEditorTabBar(props: {
  value: RoleEditorCategoryId
  onChange: (next: RoleEditorCategoryId) => void
  attentionCategories?: RoleEditorCategoryId[]
}) {
  const { value, onChange, attentionCategories } = props
  const attention = new Set<RoleEditorCategoryId>(attentionCategories || [])
  const active = ROLE_EDITOR_CATEGORIES.find((item) => item.id === value) || ROLE_EDITOR_CATEGORIES[0]

  return (
    <Box sx={{ flexShrink: 0 }}>
      <Tabs
        value={value}
        onChange={(_event, next) => onChange(next as RoleEditorCategoryId)}
        variant="fullWidth"
        aria-label="角色编辑分类"
        sx={tabBarSx}
      >
        {ROLE_EDITOR_CATEGORIES.map((item) => {
          const Icon = item.icon
          return (
            <Tab
              key={item.id}
              value={item.id}
              id={roleEditorTabDomId(item.id)}
              aria-controls={roleEditorPanelDomId(item.id)}
              disableRipple
              label={(
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
              )}
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
