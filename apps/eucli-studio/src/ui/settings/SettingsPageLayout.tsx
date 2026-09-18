import * as React from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { CustomScrollArea } from '../components/CustomScrollArea'

export type SettingsTabValue = 'appearance' | 'attachments' | 'data' | 'groups' | 'roles' | 'workspaces' | 'providers' | 'modelGroups' | 'services' | 'tools' | 'stickers' | 'hookPrompts' | 'placeholders' | 'systemPlugins' | 'eb' | 'access'

type SettingsNavigationItem = {
  value: SettingsTabValue
  label: string
}

const SETTINGS_NAVIGATION_ITEMS: SettingsNavigationItem[] = [
  { value: 'appearance', label: '外观' },
  { value: 'attachments', label: '附件' },
  { value: 'data', label: '数据' },
  { value: 'groups', label: '群组管理' },
  { value: 'roles', label: '角色管理' },
  { value: 'workspaces', label: '工作区管理' },
  { value: 'providers', label: '供应商管理' },
  { value: 'modelGroups', label: '模型组' },
  { value: 'services', label: 'AI 微服务' },
  { value: 'eb', label: 'e-b' },
  { value: 'access', label: '业务端访问' },
  { value: 'tools', label: 'AI 工具' },
  { value: 'stickers', label: '表情包' },
  { value: 'hookPrompts', label: 'hook 提示词' },
  { value: 'placeholders', label: '占位符管理' },
  { value: 'systemPlugins', label: '系统插件管理' },
]

const SETTINGS_PAGE_GAP = 12
const SETTINGS_PAGE_VERTICAL_PADDING = 16
const SETTINGS_SIDEBAR_WIDTH = { xs: 132, sm: 184, md: 220 }

function SettingsNavigationSidebar(props: { value: SettingsTabValue; onChange: (value: SettingsTabValue) => void }) {
  return (
    <Paper
      component="nav"
      aria-label="设置分区"
      elevation={0}
      sx={{
        width: SETTINGS_SIDEBAR_WIDTH,
        height: '100%',
        flexShrink: 0,
        overflow: 'hidden',
        p: 1,
        borderRadius: 3,
        color: 'var(--studio-text-primary)',
        bgcolor: 'var(--studio-field)',
        backgroundImage: 'none',
        boxShadow: 'var(--studio-shadow-strong)',
      }}
    >
      <Stack spacing={0.75} sx={{ height: '100%', minHeight: 0 }}>
        <Typography variant="body2" sx={{ px: 0.75, fontWeight: 900, whiteSpace: 'nowrap' }}>
          设置分区
        </Typography>
        <CustomScrollArea hostSx={{ minHeight: 0, flex: 1 }} scrollSx={{ height: '100%' }}>
          <Stack spacing={0.5}>
            {SETTINGS_NAVIGATION_ITEMS.map((item) => (
              <Button
                key={item.value}
                size="small"
                variant={props.value === item.value ? 'contained' : 'text'}
                onClick={() => props.onChange(item.value)}
                sx={{ justifyContent: 'flex-start', minWidth: 0, px: 1, borderRadius: 1.5, whiteSpace: 'nowrap' }}
              >
                {item.label}
              </Button>
            ))}
          </Stack>
        </CustomScrollArea>
      </Stack>
    </Paper>
  )
}

export function SettingsPageLayout(props: { topbarHeight: number; value: SettingsTabValue; onChange: (value: SettingsTabValue) => void; children: React.ReactNode }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', px: 2, pt: `calc(${props.topbarHeight}px + ${SETTINGS_PAGE_VERTICAL_PADDING}px)`, pb: 2, bgcolor: 'var(--studio-canvas)' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          gap: `${SETTINGS_PAGE_GAP}px`,
          minWidth: 0,
          height: `calc(100vh - ${props.topbarHeight}px - ${SETTINGS_PAGE_VERTICAL_PADDING * 2}px)`,
        }}
      >
        <SettingsNavigationSidebar value={props.value} onChange={props.onChange} />
        <CustomScrollArea hostSx={{ flex: 1, minWidth: 0, minHeight: 0 }} scrollSx={{ height: '100%' }}>{props.children}</CustomScrollArea>
      </Box>
    </Box>
  )
}
