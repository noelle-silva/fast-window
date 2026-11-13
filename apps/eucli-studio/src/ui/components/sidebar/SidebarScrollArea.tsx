import * as React from 'react'
import { CustomScrollArea } from '../CustomScrollArea'

// 侧边栏统一滚动区：填满剩余高度并使用全局自制滚动条。
// 顶部不留白——搜索框就是下面这份清单的头，间距交给列表自己的内边距，不两层叠加。
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
      scrollSx={{ height: '100%', pt: 0, pb: 1 }}
      onScrollPositionChange={props.onScrollPositionChange}
    >
      {props.children}
    </CustomScrollArea>
  )
}
