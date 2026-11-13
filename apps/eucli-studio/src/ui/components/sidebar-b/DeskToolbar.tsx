import * as React from 'react'
import { Box, IconButton, Tooltip } from '@mui/material'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess'

// 工作桌面自己的工具行：只放动作，不放说明文字。
// 位置与收藏夹分类的工具行齐平——分类级动作落在分类内部，不占侧边栏级顶部栏。
export type DeskToolbarProps = {
  /** 桌面上还有展开着的分组：没有可收起的分组时，「收起全部」置灰。 */
  hasExpandedGroups: boolean
  onCollapseAll: () => void
  onCreateGroup: () => void
}

export function DeskToolbar(props: DeskToolbarProps) {
  const { hasExpandedGroups, onCollapseAll, onCreateGroup } = props
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, flexShrink: 0 }}>
      <Box sx={{ flex: 1, minWidth: 0 }} />
      <Tooltip title="收起全部">
        <span>
          <IconButton
            size="small"
            aria-label="收起全部"
            onClick={onCollapseAll}
            disabled={!hasExpandedGroups}
          >
            <UnfoldLessIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <IconButton size="small" aria-label="新建分组" onClick={onCreateGroup}>
        <CreateNewFolderRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}
