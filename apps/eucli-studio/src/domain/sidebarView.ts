// 侧边栏显示视图：只决定侧边栏里展开角色面板还是工作区面板，
// 不代表整个界面的模式，也不直接决定聊天目标。

export type SidebarView = 'role' | 'workspace'

export function sidebarViewForTarget(targetKind: 'role' | 'group' | 'workspace'): SidebarView {
  return targetKind === 'workspace' ? 'workspace' : 'role'
}
