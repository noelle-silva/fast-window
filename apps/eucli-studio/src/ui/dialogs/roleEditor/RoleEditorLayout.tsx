import * as React from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import { CustomScrollArea } from '../../components/CustomScrollArea'
import {
  roleEditorPanelDomId,
  roleEditorTabDomId,
  type RoleEditorCategoryId,
} from './roleEditorCategories'

/** 角色编辑里的区块卡片：标题 + 可选说明 + 内容。fill 时卡片吃掉整块可用高度。 */
export function RoleEditorSection(props: { title: string; description?: string; fill?: boolean; children: React.ReactNode }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        borderRadius: 2.5,
        bgcolor: 'var(--studio-paper-muted)',
        boxShadow: 'var(--studio-shadow-soft)',
        ...(props.fill ? { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } : {}),
      }}
    >
      <Stack spacing={1.25} sx={props.fill ? { flex: '1 1 auto', minHeight: 0 } : undefined}>
        <Box sx={{ flexShrink: 0 }}>
          <Typography sx={{ fontWeight: 900 }}>{props.title}</Typography>
          {props.description ? (
            <Typography variant="caption" color="text.secondary">
              {props.description}
            </Typography>
          ) : null}
        </Box>
        {props.children}
      </Stack>
    </Paper>
  )
}

/**
 * 分类面板容器：自己就是这一列里的 flex item，并自带滚动视口。
 * 滚动权放在面板这一层，面板之间互不干扰，各自记住自己的阅读位置。
 * scroll={false} 的面板（提示词编辑）把高度锁死，让内容自己去适配剩余空间。
 * 非当前分类只隐藏不卸载：切换分类时输入框、预览与依赖树等本地状态都还在。
 */
export function RoleEditorCategoryPanel(props: {
  categoryId: RoleEditorCategoryId
  active: boolean
  scroll?: boolean
  children: React.ReactNode
}) {
  const { categoryId, active, scroll = true, children } = props
  return (
    <Box
      role="tabpanel"
      id={roleEditorPanelDomId(categoryId)}
      aria-labelledby={roleEditorTabDomId(categoryId)}
      hidden={!active}
      sx={{
        display: active ? 'flex' : 'none',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {scroll ? (
        <CustomScrollArea
          hostSx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, minWidth: 0 }}
          scrollSx={{ flex: '1 1 auto', minHeight: 0 }}
          contentSx={{ pr: 0.5, pb: 0.5 }}
        >
          {children}
        </CustomScrollArea>
      ) : (
        children
      )}
    </Box>
  )
}
