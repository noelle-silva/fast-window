import * as React from 'react'
import {
  forgetRoleSession,
  forgetWorkspaceSession,
  getSidebarNavigationMemory,
  rememberRoleId,
  rememberRoleSession,
  rememberWorkspaceId,
  rememberWorkspaceRole,
  rememberWorkspaceSession,
  setRoleSidebarTab,
  setWorkspaceSidebarTab,
  workspaceSessionKey,
  type RoleSidebarTab,
  type WorkspaceSidebarTab,
} from '../../domain/sidebarNavigationMemory'
import { roleSidebarSessions, workspaceSidebarSessions } from '../../domain/sidebarSessions'
import { workspaceRoleTargetId } from '../../domain/workspaceRoleTarget'
import { useEvent } from './useEvent'

function resolveRoleId(roles: any[], remembered: string) {
  return roles.some((role: any) => String(role?.id || '') === remembered)
    ? remembered
    : String(roles[0]?.id || '')
}

function resolveWorkspaceId(workspaces: any[], remembered: string) {
  return workspaces.some((workspace: any) => String(workspace?.id || '') === remembered)
    ? remembered
    : String(workspaces[0]?.id || '')
}

export function useSidebarNavigation(input: {
  controller: any
  data: any
  sidebarLayout: boolean
  sidebarVisible: boolean
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeRole: any
  activeWorkspaceId: string
  roles: any[]
  workspaces: any[]
  selectedActiveChatId: string
  activeChatTargetId: string
  pendingRoleChat: any
  pendingWorkspaceChat: any
  requestSwitch: (chatId: any, options?: { force?: boolean }) => void
  clearChatSessionRunNotice: (targetKind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) => void
}) {
  const {
    controller,
    data,
    sidebarLayout,
    sidebarVisible,
    activeTargetKind,
    activeRole,
    activeWorkspaceId,
    roles,
    workspaces,
    selectedActiveChatId,
    activeChatTargetId,
    pendingRoleChat,
    pendingWorkspaceChat,
    requestSwitch,
    clearChatSessionRunNotice,
  } = input

  const activeRoleId = String((activeRole as any)?.id || '')
  const [, setMemoryVersion] = React.useState(0)
  const bumpMemory = React.useCallback(() => setMemoryVersion((value) => value + 1), [])
  const initRef = React.useRef(false)

  const pendingRoleMatches = (roleId: string) =>
    !!pendingRoleChat && String(pendingRoleChat?.roleId || '') === roleId

  const pendingWorkspaceMatches = (workspaceId: string, roleId: string) =>
    !!pendingWorkspaceChat &&
    workspaceRoleTargetId(pendingWorkspaceChat?.workspaceId, pendingWorkspaceChat?.roleId) ===
      workspaceRoleTargetId(workspaceId, roleId)

  const switchSession = useEvent((chatId: any, options?: { force?: boolean }) => {
    const nextChatId = String(chatId || '').trim()
    if (!nextChatId) return
    if (sidebarLayout) {
      if (activeTargetKind === 'role') {
        if (activeRoleId) {
          rememberRoleSession(activeRoleId, nextChatId)
          bumpMemory()
        }
      } else if (activeTargetKind === 'workspace') {
        if (activeWorkspaceId && activeRoleId) {
          rememberWorkspaceSession(activeWorkspaceId, activeRoleId, nextChatId)
          bumpMemory()
        }
      }
    }
    requestSwitch(nextChatId, options)
  })

  const restoreRoleMode = useEvent(() => {
    const memory = getSidebarNavigationMemory()
    const roleId = resolveRoleId(roles, String(memory.role.roleId || ''))
    if (!roleId) return
    rememberRoleId(roleId)
    if (activeTargetKind !== 'role' || roleId !== activeRoleId) controller.actions.setActiveRole(roleId)
    if (!pendingRoleMatches(roleId)) {
      const sessionId = String(memory.role.sessionByRole[roleId] || '')
      if (sessionId) requestSwitch(sessionId, { force: true })
    }
    initRef.current = true
    bumpMemory()
  })

  const restoreWorkspaceMode = useEvent(() => {
    const memory = getSidebarNavigationMemory()
    const workspaceId = resolveWorkspaceId(workspaces, String(memory.workspace.workspaceId || ''))
    if (!workspaceId) return
    rememberWorkspaceId(workspaceId)
    if (activeTargetKind !== 'workspace' || workspaceId !== activeWorkspaceId) {
      controller.actions.setActiveWorkspace(workspaceId)
    }
    const roleId = resolveRoleId(roles, String(memory.workspace.roleByWorkspace[workspaceId] || ''))
    if (roleId) {
      rememberWorkspaceRole(workspaceId, roleId)
      if (roleId !== activeRoleId) controller.actions.setWorkspaceRole(roleId)
      if (!pendingWorkspaceMatches(workspaceId, roleId)) {
        const sessionId = String(memory.workspace.sessionByWorkspaceRole[workspaceSessionKey(workspaceId, roleId)] || '')
        if (sessionId) requestSwitch(sessionId, { force: true })
      }
    }
    initRef.current = true
    bumpMemory()
  })

  React.useEffect(() => {
    if (!sidebarLayout) {
      initRef.current = false
      return
    }
    if (initRef.current) return
    if (!sidebarVisible) return
    if (!data) return
    if (activeTargetKind !== 'role' && activeTargetKind !== 'workspace') return
    if (activeTargetKind === 'role') {
      if (!roles.length) return
      restoreRoleMode()
    } else {
      if (!workspaces.length || !roles.length) return
      restoreWorkspaceMode()
    }
  }, [sidebarLayout, sidebarVisible, data, activeTargetKind, roles, workspaces, restoreRoleMode, restoreWorkspaceMode])

  React.useEffect(() => {
    if (!sidebarVisible || !data || !initRef.current) return
    const memory = getSidebarNavigationMemory()
    if (activeTargetKind === 'role') {
      if (!activeRoleId) return
      const pendingId = pendingRoleMatches(activeRoleId) ? String(pendingRoleChat?.chat?.id || '') : ''
      const remembered = String(memory.role.sessionByRole[activeRoleId] || '')
      if (pendingId) {
        if (remembered !== pendingId) {
          rememberRoleSession(activeRoleId, pendingId)
          bumpMemory()
        }
        return
      }
      const { sessions } = roleSidebarSessions(data, activeRoleId)
      const ids = sessions.map((chat: any) => String(chat?.id || '')).filter(Boolean)
      if (remembered && ids.includes(remembered)) return
      if (remembered) forgetRoleSession(activeRoleId)
      const first = ids[0] || ''
      if (!first) return
      rememberRoleSession(activeRoleId, first)
      bumpMemory()
      if (first !== String(selectedActiveChatId || '')) requestSwitch(first, { force: true })
      return
    }
    if (activeTargetKind === 'workspace') {
      if (!activeWorkspaceId || !activeRoleId) return
      const key = workspaceSessionKey(activeWorkspaceId, activeRoleId)
      const pendingId = pendingWorkspaceMatches(activeWorkspaceId, activeRoleId)
        ? String(pendingWorkspaceChat?.chat?.id || '')
        : ''
      const remembered = String(memory.workspace.sessionByWorkspaceRole[key] || '')
      if (pendingId) {
        if (remembered !== pendingId) {
          rememberWorkspaceSession(activeWorkspaceId, activeRoleId, pendingId)
          bumpMemory()
        }
        return
      }
      const { sessions } = workspaceSidebarSessions(data, activeWorkspaceId, activeRoleId)
      const ids = sessions.map((chat: any) => String(chat?.id || '')).filter(Boolean)
      if (remembered && ids.includes(remembered)) return
      if (remembered) forgetWorkspaceSession(activeWorkspaceId, activeRoleId)
      const first = ids[0] || ''
      if (!first) return
      rememberWorkspaceSession(activeWorkspaceId, activeRoleId, first)
      bumpMemory()
      if (first !== String(selectedActiveChatId || '')) requestSwitch(first, { force: true })
    }
  }, [
    sidebarVisible,
    data,
    activeTargetKind,
    activeRoleId,
    activeWorkspaceId,
    selectedActiveChatId,
    pendingRoleChat,
    pendingWorkspaceChat,
    requestSwitch,
    bumpMemory,
  ])

  const selectRole = useEvent((roleIdRaw: string) => {
    const roleId = String(roleIdRaw || '').trim()
    if (!roleId) return
    rememberRoleId(roleId)
    controller.actions.setActiveRole(roleId)
    if (!pendingRoleMatches(roleId)) {
      const sessionId = String(getSidebarNavigationMemory().role.sessionByRole[roleId] || '')
      if (sessionId) requestSwitch(sessionId, { force: true })
    }
    initRef.current = true
    bumpMemory()
  })

  const selectWorkspace = useEvent((workspaceIdRaw: string) => {
    const workspaceId = String(workspaceIdRaw || '').trim()
    if (!workspaceId) return
    rememberWorkspaceId(workspaceId)
    controller.actions.setActiveWorkspace(workspaceId)
    const memory = getSidebarNavigationMemory()
    const roleId = resolveRoleId(roles, String(memory.workspace.roleByWorkspace[workspaceId] || ''))
    if (roleId) {
      rememberWorkspaceRole(workspaceId, roleId)
      if (roleId !== activeRoleId) controller.actions.setWorkspaceRole(roleId)
      if (!pendingWorkspaceMatches(workspaceId, roleId)) {
        const sessionId = String(memory.workspace.sessionByWorkspaceRole[workspaceSessionKey(workspaceId, roleId)] || '')
        if (sessionId) requestSwitch(sessionId, { force: true })
      }
    }
    initRef.current = true
    bumpMemory()
  })

  const selectWorkspaceRole = useEvent((roleIdRaw: string) => {
    const roleId = String(roleIdRaw || '').trim()
    if (!roleId || !activeWorkspaceId) return
    rememberWorkspaceRole(activeWorkspaceId, roleId)
    if (roleId !== activeRoleId) controller.actions.setWorkspaceRole(roleId)
    if (!pendingWorkspaceMatches(activeWorkspaceId, roleId)) {
      const sessionId = String(
        getSidebarNavigationMemory().workspace.sessionByWorkspaceRole[workspaceSessionKey(activeWorkspaceId, roleId)] || '',
      )
      if (sessionId) requestSwitch(sessionId, { force: true })
    }
    initRef.current = true
    bumpMemory()
  })

  const selectSession = useEvent((chatIdRaw: string) => {
    const chatId = String(chatIdRaw || '').trim()
    if (!chatId) return
    clearChatSessionRunNotice(activeTargetKind, activeChatTargetId, chatId)
    switchSession(chatId)
  })

  const changeTab = useEvent((mode: 'role' | 'workspace', tab: string) => {
    if (mode === 'role') setRoleSidebarTab(tab as RoleSidebarTab)
    else setWorkspaceSidebarTab(tab as WorkspaceSidebarTab)
    bumpMemory()
  })

  return {
    switchSession,
    restoreRoleMode,
    restoreWorkspaceMode,
    selectRole,
    selectWorkspace,
    selectWorkspaceRole,
    selectSession,
    changeTab,
  }
}
