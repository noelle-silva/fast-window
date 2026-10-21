import type { RunningSessionEntry } from '../../domain/runningSessions'
import { useEvent } from './useEvent'

export function useRunningSessionNavigation(deps: {
  controller: any
  requestSwitch: (chatId: string, options?: { force?: boolean }) => void
}) {
  const { controller, requestSwitch } = deps

  return useEvent((entry: RunningSessionEntry) => {
    if (!entry.targetId || !entry.sessionId) return
    const actions = controller?.actions

    if (entry.targetKind === 'workspace') {
      actions?.setActiveWorkspace?.(entry.workspaceId)
      actions?.setWorkspaceRole?.(entry.roleId)
    } else if (entry.targetKind === 'group') {
      actions?.setActiveGroup?.(entry.groupId)
    } else {
      actions?.setActiveRole?.(entry.roleId)
    }

    requestSwitch(entry.sessionId, { force: true })
  })
}
