import * as React from 'react'

// 现场可见性：仓库现场的浮层（对话框、菜单等）在非活动现场不渲染。
// 浮层状态本身留在现场内，切回现场时自然重现；同一现场内页面切换不受影响。
const WorkspaceVisibilityContext = React.createContext(true)

export function WorkspaceVisibilityProvider(props: { visible: boolean; children: React.ReactNode }) {
  return <WorkspaceVisibilityContext.Provider value={props.visible}>{props.children}</WorkspaceVisibilityContext.Provider>
}

export function useWorkspaceVisible(): boolean {
  return React.useContext(WorkspaceVisibilityContext)
}
