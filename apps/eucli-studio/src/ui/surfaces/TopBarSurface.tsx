import * as React from 'react'
import { useRenderProbe } from '../../diagnostics/renderProbe'
import { useUiDataVersion } from '../hooks/useScopedUiVersion'
import { ChatTopBar } from '../components/ChatTopBar'

export type TopBarSurfaceProps = React.ComponentProps<typeof ChatTopBar> & {
  controller?: any
}

// 顶栏表面：稳定 nav 模型与 handler 由 App 提供。
// 迁移期先自订阅全局数据版本（阶段 3 换成 navigation / uiShell），
// 保证 App 根逐步让出订阅后顶栏仍然刷新。
export const TopBarSurface = React.memo(function TopBarSurface(props: TopBarSurfaceProps) {
  useRenderProbe('topbar')
  useUiDataVersion(props.controller)
  const { controller: _controller, ...rest } = props
  return <ChatTopBar {...rest} />
})
