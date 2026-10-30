import * as React from 'react'
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { DependablePopover } from '../components/DependableOverlay'
import { SOFT_POPOVER_PAPER_SX } from '../softPopoverStyles'
import { REASONING_EFFORT_OPTIONS } from '../../domain/reasoning'
import { numericTimeValue } from '../utils/time'
import { ModelSourcePicker } from '../components/ModelSourcePicker'
import { RoleModelCandidateList } from '../components/RoleModelCandidateList'
import { useUiDataVersion } from '../hooks/useScopedUiVersion'

// 独立刷新：用 memo 隔离，只有自身输入变化时才重绘，不被无关整页刷新牵连。
export const ComposerControlsPopovers = React.memo(function ComposerControlsPopovers(props: {
  controller: any
  loading: boolean
  providers: any[]
  modelGroups: any[]
  roleSessionControlsEnabled: boolean
  tempModelPickerEl: HTMLElement | null
  closeTempModelPicker: () => void
  tempModelSource: 'provider' | 'model_group'
  onTempModelSourceChanged: (kind: 'provider' | 'model_group') => void
  tempModelProviderId: string
  onTempProviderChanged: (providerId: string) => void
  tempModelGroupId: string
  onTempModelGroupChanged: (groupId: string) => void
  tempModelPick: string
  setTempModelPick: React.Dispatch<React.SetStateAction<string>>
  tempModelReady: boolean
  roleModelCandidates: any[]
  tempModelHighlightKey: string
  onPickRoleModelCandidate: (candidate: any) => void
  clearTempModelOverride: () => void
  hasChatOverride: boolean
  saveTempModelOverride: () => void
  reasoningPickerEl: HTMLElement | null
  closeReasoningPicker: () => void
  activeEffectiveReasoningEffort: any
  activeChatReasoningEffort: any
  pickReasoningEffort: (effort: string) => void
  clearReasoningEffort: () => void
  hasChatReasoningOverride: boolean
  asyncToolTasksEl: HTMLElement | null
  closeAsyncToolTasks: () => void
  refreshAsyncToolTasks: () => Promise<void> | void
  asyncToolTasksLoading: boolean
  asyncToolTasks: any[]
}) {
  const {
    controller,
    loading,
    providers,
    modelGroups,
    roleSessionControlsEnabled,
    tempModelPickerEl,
    closeTempModelPicker,
    tempModelSource,
    onTempModelSourceChanged,
    tempModelProviderId,
    onTempProviderChanged,
    tempModelGroupId,
    onTempModelGroupChanged,
    tempModelPick,
    setTempModelPick,
    tempModelReady,
    roleModelCandidates,
    tempModelHighlightKey,
    onPickRoleModelCandidate,
    clearTempModelOverride,
    hasChatOverride,
    saveTempModelOverride,
    reasoningPickerEl,
    closeReasoningPicker,
    activeEffectiveReasoningEffort,
    activeChatReasoningEffort,
    pickReasoningEffort,
    clearReasoningEffort,
    hasChatReasoningOverride,
    asyncToolTasksEl,
    closeAsyncToolTasks,
    refreshAsyncToolTasks,
    asyncToolTasksLoading,
    asyncToolTasks,
  } = props

  // 订阅全局数据版本：数据变化时本组件仍刷新；父级本地 UI 变化被 memo 挡在外面。
  useUiDataVersion(controller)

  return (
    <>
      <DependablePopover
        open={!!asyncToolTasksEl}
        anchorEl={asyncToolTasksEl}
        onClose={closeAsyncToolTasks}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box data-area="async-tool-tasks" sx={{ width: 380, p: 1.5 }}>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>异步工具任务</Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={refreshAsyncToolTasks} disabled={asyncToolTasksLoading}>刷新</Button>
              <Button size="small" onClick={closeAsyncToolTasks}>关闭</Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">只读展示当前会话的后台工具任务。</Typography>
            {asyncToolTasksLoading ? (
              <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={16} /><Typography variant="body2">加载中…</Typography></Stack>
            ) : asyncToolTasks.length ? (
              <Stack spacing={1}>
                {asyncToolTasks.map((task: any) => {
                  const status = String(task?.status || '').trim() || 'unknown'
                  const submittedAt = numericTimeValue(task?.submittedAt)
                  const startedAt = numericTimeValue(task?.startedAt)
                  const finishedAt = numericTimeValue(task?.finishedAt)
                  const elapsed = startedAt && finishedAt ? `${Math.max(0, Math.round((finishedAt - startedAt) / 1000))}s` : startedAt ? '运行中' : '-'
                  return (
                    <Paper key={String(task?.id || `${task?.toolName}-${task?.submittedAt}`)} variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
                      <Stack spacing={0.5}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2" sx={{ fontWeight: 800, minWidth: 0, flex: 1 }} noWrap>{String(task?.taskName || task?.toolName || '工具任务')}</Typography>
                          <Chip size="small" label={status} color={status === 'succeeded' || status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'warning'} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">工具：{String(task?.toolName || '-')}</Typography>
                        <Typography variant="caption" color="text.secondary">提交：{submittedAt ? new Date(submittedAt).toLocaleString() : '-'}</Typography>
                        <Typography variant="caption" color="text.secondary">耗时：{elapsed}</Typography>
                      </Stack>
                    </Paper>
                  )
                })}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">当前会话暂无异步工具任务。</Typography>
            )}
          </Stack>
        </Box>
      </DependablePopover>

      <DependablePopover
        open={roleSessionControlsEnabled && !!tempModelPickerEl}
        anchorEl={tempModelPickerEl}
        onClose={closeTempModelPicker}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{ sx: SOFT_POPOVER_PAPER_SX }}
      >
        <Box data-area="temp-model" sx={{ width: 420, p: 1.75 }}>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                当前会话临时模型
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={closeTempModelPicker}>
                关闭
              </Button>
            </Stack>

            <Typography variant="caption" color="text.secondary">
              仅影响当前会话；不修改角色设置。
            </Typography>

            <ModelSourcePicker
              value={{ kind: tempModelSource, providerId: tempModelProviderId, groupId: tempModelGroupId, modelId: tempModelPick }}
              providers={providers}
              modelGroups={modelGroups}
              disabled={loading}
              onSourceChanged={onTempModelSourceChanged}
              onProviderChanged={onTempProviderChanged}
              onModelGroupChanged={onTempModelGroupChanged}
              onModelChanged={setTempModelPick}
            />

            <Typography variant="body2" sx={{ fontWeight: 900 }}>
              角色候选模型（{roleModelCandidates.length}）
            </Typography>

            <RoleModelCandidateList
              candidates={roleModelCandidates}
              providers={providers}
              modelGroups={modelGroups}
              highlightedKey={tempModelHighlightKey}
              highlightLabel="临时模型"
              emptyHint="这个角色还没有候选模型，可到角色设置里添加。"
              onSelect={onPickRoleModelCandidate}
            />

            <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" sx={{ pt: 0.5 }}>
              <Button variant="text" onClick={clearTempModelOverride} disabled={!hasChatOverride || loading}>
                清除临时模型（跟随角色）
              </Button>
              <Button variant="contained" onClick={saveTempModelOverride} disabled={loading || !tempModelReady}>
                保存
              </Button>
            </Stack>
          </Stack>
        </Box>
      </DependablePopover>

      <DependablePopover
        open={roleSessionControlsEnabled && !!reasoningPickerEl}
        anchorEl={reasoningPickerEl}
        onClose={closeReasoningPicker}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box data-area="reasoning-effort" sx={{ width: 300, p: 1.5 }}>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                当前会话思考等级
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={closeReasoningPicker}>关闭</Button>
            </Stack>

            <Typography variant="caption" color="text.secondary">
              仅影响当前会话；不修改模型默认设置。
            </Typography>

            <Stack spacing={0.75}>
              {REASONING_EFFORT_OPTIONS.map((option) => {
                const selected = String(activeEffectiveReasoningEffort || '') === option.value
                const sessionSelected = String(activeChatReasoningEffort || '') === option.value
                return (
                  <Button
                    key={option.value}
                    variant={selected ? 'contained' : 'outlined'}
                    onClick={() => pickReasoningEffort(option.value)}
                    disabled={loading}
                    sx={{ justifyContent: 'space-between', borderRadius: 2 }}
                  >
                    <span>{option.label}</span>
                    <span style={{ fontSize: 12, opacity: 0.75 }}>{sessionSelected ? '当前会话' : selected ? '默认生效' : ''}</span>
                  </Button>
                )
              })}
            </Stack>

            <Button variant="text" onClick={clearReasoningEffort} disabled={!hasChatReasoningOverride || loading}>
              恢复模型默认
            </Button>
          </Stack>
        </Box>
      </DependablePopover>
    </>
  )
})
