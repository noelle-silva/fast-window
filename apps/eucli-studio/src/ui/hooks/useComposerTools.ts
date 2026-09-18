import * as React from 'react'
import { registeredModelItems } from '../settings/modelItemSelectors'
import { useEvent } from './useEvent'

export function useComposerTools(deps: {
  controller: any
  roleSessionControlsEnabled: boolean
  activeRole: any
  providers: any[]
  effectiveProviderId: string
  effectiveModelId: string
  reasoningProfile: any
  activeTargetKind: 'role' | 'group' | 'workspace'
  activeGroupId: string
  activeWorkspaceId: string
  activeChatId: string
  activeAsyncToolTasks: any[]
}) {
  const {
    controller,
    roleSessionControlsEnabled,
    activeRole,
    providers,
    effectiveProviderId,
    effectiveModelId,
    reasoningProfile,
    activeTargetKind,
    activeGroupId,
    activeWorkspaceId,
    activeChatId,
    activeAsyncToolTasks,
  } = deps

  const [tempModelPickerEl, setTempModelPickerEl] = React.useState<HTMLElement | null>(null)
  const [tempModelProviderId, setTempModelProviderId] = React.useState('')
  const [tempModelPick, setTempModelPick] = React.useState('')
  const [reasoningPickerEl, setReasoningPickerEl] = React.useState<HTMLElement | null>(null)
  const [asyncToolTasksEl, setAsyncToolTasksEl] = React.useState<HTMLElement | null>(null)
  const [asyncToolTasks, setAsyncToolTasks] = React.useState<any[]>([])
  const [asyncToolTasksLoading, setAsyncToolTasksLoading] = React.useState(false)

  React.useEffect(() => {
    if (roleSessionControlsEnabled) return
    setTempModelPickerEl(null)
    setReasoningPickerEl(null)
  }, [roleSessionControlsEnabled])

  const closeTempModelPicker = useEvent(() => setTempModelPickerEl(null))
  const closeAsyncToolTasks = useEvent(() => setAsyncToolTasksEl(null))
  const openTempModelPicker = useEvent((e: React.MouseEvent<HTMLElement>) => {
    if (!roleSessionControlsEnabled) return
    if (!activeRole) return
    if (!providers.length) return controller?.capabilities?.ui?.showToast?.('暂无供应商', { kind: 'error' })

    const pid0 = effectiveProviderId || String((providers[0] as any)?.id || '')
    const mid0 = effectiveModelId || ''

    const pid = String(pid0 || '').trim()
    const mid = String(mid0 || '').trim()

    setTempModelProviderId(pid)

    const p = providers.find((x: any) => String(x?.id || '') === pid) || null
    const items = registeredModelItems(p)
    const inList = !!mid && items.some((x: any) => x.id === mid)

    setTempModelPick(inList ? mid : '')
    setTempModelPickerEl(e.currentTarget)
  })

  const refreshAsyncToolTasks = useEvent(async () => {
    const request = controller?.capabilities?.net?.request
    if (typeof request !== 'function') return
    const params = new URLSearchParams()
    if (activeTargetKind === 'group') params.set('groupId', String(activeGroupId || ''))
    else if (activeTargetKind === 'workspace') params.set('workspaceId', String(activeWorkspaceId || ''))
    if (activeRole?.id) params.set('roleId', String(activeRole.id || ''))
    if (activeChatId) params.set('sessionId', String(activeChatId || ''))
    setAsyncToolTasksLoading(true)
    try {
      const response = await request({ method: 'GET', path: `/api/async-tool-tasks?${params.toString()}`, timeoutMs: 15000 })
      setAsyncToolTasks(Array.isArray(response?.body) ? response.body : [])
    } catch (err: any) {
      controller?.capabilities?.ui?.showToast?.(String(err?.message || err || '异步任务列表加载失败'), { kind: 'error' })
    } finally {
      setAsyncToolTasksLoading(false)
    }
  })

  const openAsyncToolTasks = useEvent((e: React.MouseEvent<HTMLElement>) => {
    if (!activeRole || !activeChatId) return
    setAsyncToolTasksEl(e.currentTarget)
    setAsyncToolTasks(activeAsyncToolTasks)
    refreshAsyncToolTasks()
  })

  const onTempProviderChanged = useEvent((nextProviderId: string) => {
    const pid = String(nextProviderId || '').trim()
    setTempModelProviderId(pid)
    setTempModelPick('')
  })

  const saveTempModelOverride = useEvent(() => {
    const pid = String(tempModelProviderId || '').trim()
    const mid = String(tempModelPick || '').trim()

    if (!pid) return controller?.capabilities?.ui?.showToast?.('请选择供应商', { kind: 'error' })
    if (!mid) return controller?.capabilities?.ui?.showToast?.('请选择模型', { kind: 'error' })

    controller.actions.setChatModelOverride?.(pid, mid)
    closeTempModelPicker()
  })

  const clearTempModelOverride = useEvent(() => {
    controller.actions.clearChatModelOverride?.()
    closeTempModelPicker()
  })
  const closeReasoningPicker = useEvent(() => setReasoningPickerEl(null))
  const openReasoningPicker = useEvent((e: React.MouseEvent<HTMLElement>) => {
    if (!roleSessionControlsEnabled) return
    if (!reasoningProfile.supportsReasoning) return
    setReasoningPickerEl(e.currentTarget)
  })
  const pickReasoningEffort = useEvent((effort: string) => {
    controller.actions.setChatReasoningEffort?.(effort)
    closeReasoningPicker()
  })
  const clearReasoningEffort = useEvent(() => {
    controller.actions.setChatReasoningEffort?.('')
    closeReasoningPicker()
  })

  return {
    tempModelPickerEl,
    tempModelProviderId,
    tempModelPick,
    setTempModelPick,
    reasoningPickerEl,
    asyncToolTasksEl,
    asyncToolTasks,
    asyncToolTasksLoading,
    closeTempModelPicker,
    openTempModelPicker,
    onTempProviderChanged,
    saveTempModelOverride,
    clearTempModelOverride,
    openReasoningPicker,
    pickReasoningEffort,
    clearReasoningEffort,
    closeReasoningPicker,
    closeAsyncToolTasks,
    refreshAsyncToolTasks,
    openAsyncToolTasks,
  }
}
