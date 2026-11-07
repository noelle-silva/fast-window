import * as React from 'react'
import { Box } from '@mui/material'
import { CustomScrollArea } from '../CustomScrollArea'

/**
 * 分类面板容器：自己就是这一列里的 flex item，并自带滚动视口。
 * 滚动权放在面板这一层，面板之间互不干扰，各自记住自己的阅读位置。
 * scroll={false} 的面板把高度锁死，让内容自己去适配剩余空间。
 * 非当前分类只隐藏不卸载：切换分类时输入框、预览等本地状态都还在。
 */
export function CategoryEditorPanel(props: {
  active: boolean
  /** 面板与切换栏的 DOM id，必须来自同一份分类目录。 */
  tabId: string
  panelId: string
  scroll?: boolean
  children: React.ReactNode
}) {
  const { active, tabId, panelId, scroll = true, children } = props
  return (
    <Box
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
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
