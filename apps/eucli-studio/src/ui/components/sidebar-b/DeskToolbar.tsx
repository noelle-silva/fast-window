import * as React from 'react'
import { Box, IconButton } from '@mui/material'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'

// 工作桌面自己的工具行：只放动作，不放说明文字。
// 位置与收藏夹分类的工具行齐平——分类级动作落在分类内部，不占侧边栏级顶部栏。
export function DeskToolbar(props: { onCreateGroup: () => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, flexShrink: 0 }}>
      <Box sx={{ flex: 1, minWidth: 0 }} />
      <IconButton size="small" aria-label="新建分组" onClick={props.onCreateGroup}>
        <CreateNewFolderRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}
