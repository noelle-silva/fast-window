import * as React from 'react'
import { CustomScrollArea } from '../CustomScrollArea'

// 侧边栏统一滚动区：填满剩余高度并使用全局自制滚动条。
// 需要分批加载的列表把滚动元素引用与滚动回调接进来即可。
export function SidebarScrollArea(props: {
  children: React.ReactNode
  scrollRef?: React.Ref<HTMLDivElement>
  onScrollPositionChange?: (el: HTMLDivElement) => void
}) {
  return (
    <CustomScrollArea
      ref={props.scrollRef}
      hostSx={{ flex: 1, minHeight: 0 }}
      scrollSx={{ height: '100%', py: 1 }}
      onScrollPositionChange={props.onScrollPositionChange}
    >
      {props.children}
    </CustomScrollArea>
  )
}
