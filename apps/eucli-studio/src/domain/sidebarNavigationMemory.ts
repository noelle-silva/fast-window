import { workspaceRoleTargetId } from './workspaceRoleTarget'

export type RoleSidebarTab = 'roles' | 'history'
export type WorkspaceSidebarTab = 'workspaces' | 'roles' | 'session'
// 侧边栏 B 的两段：工作桌面（会话手边清单）与会话收藏夹（收藏夹树）。
// 加分类时在这里追加取值，侧边栏 B 的页签表与面板分派跟着同一套类型走。
export type DeskSidebarTab = 'desk' | 'favorites'

export type SidebarNavigationMemory = {
  role: {
    tab: RoleSidebarTab
    roleId: string
    sessionByRole: Record<string, string>
  }
  workspace: {
    tab: WorkspaceSidebarTab
    workspaceId: string
    roleByWorkspace: Record<string, string>
    sessionByWorkspaceRole: Record<string, string>
  }
  desk: {
    tab: DeskSidebarTab
  }
}

function text(value: unknown) {
  return String(value || '').trim()
}

function createMemory(): SidebarNavigationMemory {
  return {
    role: {
      tab: 'roles',
      roleId: '',
      sessionByRole: {},
    },
    workspace: {
      tab: 'workspaces',
      workspaceId: '',
      roleByWorkspace: {},
      sessionByWorkspaceRole: {},
    },
    desk: {
      tab: 'desk',
    },
  }
}

let memory = createMemory()

export function getSidebarNavigationMemory() {
  return memory
}

export function resetSidebarNavigationMemory() {
  memory = createMemory()
}

export function setRoleSidebarTab(tab: RoleSidebarTab) {
  memory.role.tab = tab === 'history' ? 'history' : 'roles'
}

export function setWorkspaceSidebarTab(tab: WorkspaceSidebarTab) {
  memory.workspace.tab = tab === 'session' ? 'session' : tab === 'roles' ? 'roles' : 'workspaces'
}

export function setDeskSidebarTab(tab: DeskSidebarTab) {
  memory.desk.tab = tab
}

export function rememberRoleId(roleId: unknown) {
  const id = text(roleId)
  if (id) memory.role.roleId = id
}

export function rememberRoleSession(roleId: unknown, chatId: unknown) {
  const id = text(roleId)
  const chat = text(chatId)
  if (id && chat) memory.role.sessionByRole[id] = chat
}

export function forgetRoleSession(roleId: unknown) {
  const id = text(roleId)
  if (id) delete memory.role.sessionByRole[id]
}

export function rememberWorkspaceId(workspaceId: unknown) {
  const id = text(workspaceId)
  if (id) memory.workspace.workspaceId = id
}

export function rememberWorkspaceRole(workspaceId: unknown, roleId: unknown) {
  const workspace = text(workspaceId)
  const role = text(roleId)
  if (workspace && role) memory.workspace.roleByWorkspace[workspace] = role
}

export function rememberWorkspaceSession(workspaceId: unknown, roleId: unknown, chatId: unknown) {
  const key = workspaceSessionKey(workspaceId, roleId)
  const chat = text(chatId)
  if (key && chat) memory.workspace.sessionByWorkspaceRole[key] = chat
}

export function forgetWorkspaceSession(workspaceId: unknown, roleId: unknown) {
  const key = workspaceSessionKey(workspaceId, roleId)
  if (key) delete memory.workspace.sessionByWorkspaceRole[key]
}

export function workspaceSessionKey(workspaceId: unknown, roleId: unknown) {
  return workspaceRoleTargetId(workspaceId, roleId)
}
