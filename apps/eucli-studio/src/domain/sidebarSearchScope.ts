import type { RoleSidebarTab, WorkspaceSidebarTab } from './sidebarNavigationMemory'

// 侧边栏 A 的搜索词属于「它被输入时的那一份列表」。
// 范围键只收进真正决定列表内容的字段：换页签、换会话目标都算换了一份列表，旧关键词不该跟过去；
// 工作区 / 角色两个实体页签的清单与当前目标无关，所以点选一个工作区不会把刚打好的过滤词清掉。
export type SidebarSearchScopeInput = {
  view: 'role' | 'workspace'
  tab: RoleSidebarTab | WorkspaceSidebarTab
  activeRoleId: string
  activeWorkspaceId: string
}

function text(value: unknown) {
  return String(value || '').trim()
}

export function sidebarSearchScopeKey(input: SidebarSearchScopeInput) {
  const view = input.view === 'workspace' ? 'workspace' : 'role'
  if (view === 'role' && input.tab === 'history') return `role:history:${text(input.activeRoleId)}`
  if (view === 'workspace' && input.tab === 'session') {
    return `workspace:session:${text(input.activeWorkspaceId)}|${text(input.activeRoleId)}`
  }
  return `${view}:${input.tab}`
}
