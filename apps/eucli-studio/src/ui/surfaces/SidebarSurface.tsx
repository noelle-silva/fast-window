import * as React from 'react'
import { useRenderProbe } from '../../diagnostics/renderProbe'
import { ChatSidebar } from '../components/ChatSidebar'

export type SidebarSurfaceProps = React.ComponentProps<typeof ChatSidebar> & {
  // 侧边栏记忆是模块级可变对象，必须用这个版本号穿透 memo。
  navigationVersion: number
}

// 侧边栏表面：内部继续自订阅数据版本，外层用稳定 props 隔开父级本地状态。
export const SidebarSurface = React.memo(function SidebarSurface(props: SidebarSurfaceProps) {
  useRenderProbe('sidebar')
  const { navigationVersion: _navigationVersion, ...rest } = props
  return <ChatSidebar {...rest} />
})
