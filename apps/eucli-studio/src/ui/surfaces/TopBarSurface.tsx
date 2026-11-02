import * as React from 'react'
import { useRenderProbe } from '../../diagnostics/renderProbe'
import { ChatTopBar } from '../components/ChatTopBar'

// 顶栏表面：内容全部来自 App 的稳定 nav 模型与页面路由。
// 数据变化先经 App 的 navigation / chatList / appData 订阅重算 nav props，
// 顶栏自身不再建立任何数据订阅，更不订阅全局版本。
export const TopBarSurface = React.memo(function TopBarSurface(props: React.ComponentProps<typeof ChatTopBar>) {
  useRenderProbe('topbar')
  return <ChatTopBar {...props} />
})
