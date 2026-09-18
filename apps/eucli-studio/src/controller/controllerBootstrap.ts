import { upsertEbRoleRunCard, removeEbRoleRunCard } from '../domain/activeRunCards'
import { getRunState, isTerminalRunStatus, listActiveRoleRuns, pollRunUntilTerminal, type EbRunState } from './ebRoleRun'
import type { AiChatShowToast } from '../gateway/capabilities'

export function createControllerBootstrap(deps: {
  state: any
  render: () => void
  showToast?: AiChatShowToast
  getNetRequest: () => ((req: any) => Promise<any>) | undefined
  isDisposed: () => boolean
  ensureSplitStoreReady: () => Promise<any>
  loadShell: () => Promise<any>
  refreshWorkspaces: (activeWorkspaceId?: any) => Promise<any>
  ensureActiveWorkspaceChatLoaded: () => Promise<any>
  ensureStoredActiveChatLoaded: () => Promise<any>
  refreshHookPromptLibrary: (force?: boolean) => Promise<any>
  refreshPlaceholderLibrary: (force?: boolean) => Promise<any>
  reloadRoleSession: (roleId: any, sessionId: any) => Promise<any>
  reloadGroupSession: (groupId: any, sessionId: any) => Promise<any>
  reloadWorkspaceSession: (workspaceId: any, sessionId: any, roleId?: any) => Promise<any>
}) {
  const { state, render, showToast, getNetRequest, isDisposed, ensureSplitStoreReady, loadShell, refreshWorkspaces, ensureActiveWorkspaceChatLoaded, ensureStoredActiveChatLoaded, refreshHookPromptLibrary, refreshPlaceholderLibrary, reloadRoleSession, reloadGroupSession, reloadWorkspaceSession } = deps
  const restoringRunIds = new Set<string>()

  async function load() {
    try {
      await ensureSplitStoreReady()
      const split = await loadShell()
      if (!split) throw new Error('存储未初始化')
      state.data = split
      state.draft.activeRoleId = String(split?.ui?.activeRoleId || '')
      state.draft.activeGroupId = String((split?.ui as any)?.activeGroupId || '')
      ;(state.draft as any).activeWorkspaceId = String((split?.ui as any)?.activeWorkspaceId || '')
      const targetKind = String((split?.ui as any)?.activeTargetKind || 'role').trim()
      state.draft.activeTargetKind = targetKind === 'group' ? 'group' : targetKind === 'workspace' ? 'workspace' : 'role'
      await refreshWorkspaces((state.draft as any).activeWorkspaceId || undefined).catch(() => null)
      if (state.draft.activeTargetKind === 'workspace') await ensureActiveWorkspaceChatLoaded().catch(() => null)
      else await ensureStoredActiveChatLoaded()
      await refreshHookPromptLibrary(false).catch(() => null)
      await refreshPlaceholderLibrary(false).catch(() => null)
    } catch (e: any) {
      state.data = null
      state.draft.activeRoleId = ''
      state.draft.activeGroupId = ''
      ;(state.draft as any).activeWorkspaceId = ''
      state.draft.activeTargetKind = 'role'
      showToast?.(String(e?.message || e || '加载失败'), { kind: 'error' })
    } finally {
      state.loading = false
    }
  }

  async function restoreActiveEbRoleRuns() {
    const netRequest = getNetRequest()
    if (typeof netRequest !== 'function') return
    const runs = await listActiveRoleRuns(netRequest).catch(() => [])
    const syncRunCard = (run: EbRunState) => {
      const runId = String(run?.id || '').trim()
      const roleId = String(run?.roleId || '').trim()
      const groupId = String((run as any)?.groupId || '').trim()
      const workspaceId = String((run as any)?.workspaceId || '').trim()
      const sessionId = String(run?.sessionId || '').trim()
      if (!runId || !roleId || !sessionId) return false
      upsertEbRoleRunCard(state, {
        runId,
        roleId,
        groupId,
        workspaceId,
        sessionId,
        inputMessageId: String(run?.inputMessageId || '').trim(),
        lastMessageId: String(run?.lastMessageId || run?.inputMessageId || '').trim(),
        anchorMessageId: String(run?.inputMessageId || '').trim(),
        dependencyMessageIds: Array.isArray(run?.dependencyMessageIds) ? run.dependencyMessageIds : [],
        status: String(run?.status || 'running').trim() || 'running',
        stream: !!run?.stream,
        retry: run?.retry,
      })
      return true
    }
    const trackRestoredRun = (initialRun: EbRunState) => {
      const runId = String(initialRun?.id || '').trim()
      if (!runId || restoringRunIds.has(runId)) return
      restoringRunIds.add(runId)
      Promise.resolve()
        .then(async () => {
          let latest = await getRunState(netRequest, runId).catch(() => initialRun)
          if (syncRunCard(latest)) render()
          if (!isTerminalRunStatus(latest.status)) {
            latest = await pollRunUntilTerminal(
              netRequest,
              latest,
              async (nextRun) => {
                latest = nextRun
                if (syncRunCard(nextRun)) render()
              },
              { shouldContinue: () => !isDisposed() },
            )
          }
          const roleId = String(latest?.roleId || '').trim()
          const groupId = String((latest as any)?.groupId || '').trim()
          const workspaceId = String((latest as any)?.workspaceId || '').trim()
          const sessionId = String(latest?.sessionId || '').trim()
          if (workspaceId && sessionId && typeof reloadWorkspaceSession === 'function') {
            await reloadWorkspaceSession(workspaceId, sessionId, latest.roleId).catch(() => null)
          } else if (groupId && sessionId && typeof reloadGroupSession === 'function') {
            await reloadGroupSession(groupId, sessionId).catch(() => null)
          } else if (roleId && sessionId && typeof reloadRoleSession === 'function') {
            await reloadRoleSession(roleId, sessionId).catch(() => null)
          }
          removeEbRoleRunCard(state, runId)
          render()
        })
        .finally(() => {
          restoringRunIds.delete(runId)
        })
    }
    let changed = false
    for (const run of runs) {
      if (!syncRunCard(run)) continue
      changed = true
      trackRestoredRun(run)
    }
    if (changed) render()
  }

  return { load, restoreActiveEbRoleRuns }
}
