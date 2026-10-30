import * as React from 'react'
import { modelCandidateKey, normalizeRoleModelCandidates, type RoleModelCandidate } from '../../domain/roleModelCandidates'
import { normalizeModelRef } from '../../domain/modelRefUtils'
import type { ModelSourceKind } from '../components/ModelSourcePicker'
import { registeredModelItems, modelGroupModelItems } from '../settings/modelItemSelectors'
import { useEvent } from './useEvent'

export function useComposerTools(deps: {
  controller: any
  roleSessionControlsEnabled: boolean
  activeRole: any
  providers: any[]
  modelGroups: any[]
  effectiveModelRef: any
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
    modelGroups,
    effectiveModelRef,
    reasoningProfile,
    activeTargetKind,
    activeGroupId,
    activeWorkspaceId,
    activeChatId,
    activeAsyncToolTasks,
  } = deps

  const [tempModelPickerEl, setTempModelPickerEl] = React.useState<HTMLElement | null>(null)
  const [tempModelSource, setTempModelSource] = React.useState<ModelSourceKind>('provider')
  const [tempModelProviderId, setTempModelProviderId] = React.useState('')
  const [tempModelGroupId, setTempModelGroupId] = React.useState('')
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

  // 角色候选池是临时模型弹窗底部的可选项来源；角色设置变化时随数据一起刷新。
  const roleModelCandidates = React.useMemo<RoleModelCandidate[]>(
    () => normalizeRoleModelCandidates(activeRole?.modelCandidates),
    [activeRole?.modelCandidates],
  )

  const closeTempModelPicker = useEvent(() => setTempModelPickerEl(null))
  const closeAsyncToolTasks = useEvent(() => setAsyncToolTasksEl(null))

  const openTempModelPicker = useEvent((e: React.MouseEvent<HTMLElement>) => {
    if (!roleSessionControlsEnabled) return
    if (!activeRole) return
    if (!providers.length && !modelGroups.length) return controller?.capabilities?.ui?.showToast?.('暂无供应商', { kind: 'error' })

    // 用当前生效模型预填，保证打开弹窗时选择器与输入栏显示一致。
    const current = normalizeModelRef(effectiveModelRef)
    if (current?.kind === 'model_group') {
      setTempModelSource('model_group')
      setTempModelProviderId('')
      setTempModelGroupId(current.groupId)
      setTempModelPick(current.modelId)
    } else {
      const pid = String(current?.providerId || '').trim() || String((providers[0] as any)?.id || '')
      setTempModelSource('provider')
      setTempModelProviderId(pid)
      setTempModelGroupId('')
      const p = providers.find((x: any) => String(x?.id || '') === pid) || null
      const items = registeredModelItems(p)
      const mid = String(current?.modelId || '').trim()
      setTempModelPick(mid && items.some((x: any) => x.id === mid) ? mid : '')
    }
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

  const onTempModelSourceChanged = useEvent((kind: ModelSourceKind) => {
    setTempModelSource(kind === 'model_group' ? 'model_group' : 'provider')
    setTempModelPick('')
  })

  const onTempProviderChanged = useEvent((nextProviderId: string) => {
    setTempModelProviderId(String(nextProviderId || '').trim())
    setTempModelPick('')
  })

  const onTempModelGroupChanged = useEvent((nextGroupId: string) => {
    setTempModelGroupId(String(nextGroupId || '').trim())
    setTempModelPick('')
  })

  const tempModelRef = normalizeModelRef(tempModelSource === 'model_group'
    ? { kind: 'model_group', providerId: '', groupId: tempModelGroupId, modelId: tempModelPick }
    : { kind: 'provider', providerId: tempModelProviderId, groupId: '', modelId: tempModelPick })
  const tempModelReady = !!tempModelRef
  const tempModelHighlightKey = tempModelRef ? modelCandidateKey(tempModelRef) : ''

  // 点击角色候选模型：直接把它作为临时模型保存，省掉「先选中再保存」。
  const onPickRoleModelCandidate = useEvent((candidate: RoleModelCandidate) => {
    const ref = normalizeModelRef(candidate)
    if (!ref) return
    controller.actions.setChatModelOverride?.(ref)
    closeTempModelPicker()
  })

  const saveTempModelOverride = useEvent(() => {
    const ref = tempModelRef
    if (!ref) return controller?.capabilities?.ui?.showToast?.('请选择模型', { kind: 'error' })
    controller.actions.setChatModelOverride?.(ref)
    closeTempModelPicker()
  })

  // 候选模型前后切换：只在角色候选池内移动，到头即停，不循环。
  const effectiveCandidateRef = normalizeModelRef(effectiveModelRef)
  const effectiveCandidateKey = effectiveCandidateRef ? modelCandidateKey(effectiveCandidateRef) : ''
  const effectiveCandidateIndex = effectiveCandidateKey
    ? roleModelCandidates.findIndex((candidate) => modelCandidateKey(candidate) === effectiveCandidateKey)
    : -1
  const roleModelStepPrevEnabled = effectiveCandidateIndex > 0
  const roleModelStepNextEnabled = effectiveCandidateIndex >= 0 && effectiveCandidateIndex < roleModelCandidates.length - 1

  const stepRoleModelCandidate = useEvent((delta: number) => {
    if (!roleSessionControlsEnabled) return
    if (effectiveCandidateIndex < 0) return
    const nextIndex = effectiveCandidateIndex + (Number(delta) < 0 ? -1 : 1)
    if (nextIndex < 0 || nextIndex >= roleModelCandidates.length) return
    const ref = normalizeModelRef(roleModelCandidates[nextIndex])
    if (!ref) return
    controller.actions.setChatModelOverride?.(ref)
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
    tempModelSource,
    tempModelProviderId,
    tempModelGroupId,
    tempModelPick,
    setTempModelPick,
    tempModelReady,
    roleModelCandidates,
    tempModelHighlightKey,
    onPickRoleModelCandidate,
    roleModelStepPrevEnabled,
    roleModelStepNextEnabled,
    stepRoleModelCandidate,
    reasoningPickerEl,
    asyncToolTasksEl,
    asyncToolTasks,
    asyncToolTasksLoading,
    closeTempModelPicker,
    openTempModelPicker,
    onTempModelSourceChanged,
    onTempProviderChanged,
    onTempModelGroupChanged,
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
