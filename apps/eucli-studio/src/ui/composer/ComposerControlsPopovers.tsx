import * as React from 'react'
import { Box, Button, Chip, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Popover, Select, Stack, Typography } from '@mui/material'
import { SOFT_POPOVER_PAPER_SX } from '../softPopoverStyles'
import { REASONING_EFFORT_OPTIONS } from '../../domain/reasoning'
import { numericTimeValue } from '../utils/time'
import { providerSelectItems, registeredModelItems } from '../settings/modelItemSelectors'

export function ComposerControlsPopovers(props: {
  loading: boolean
  providers: any[]
  roleSessionControlsEnabled: boolean
  tempModelPickerEl: HTMLElement | null
  closeTempModelPicker: () => void
  tempModelProviderId: string
  onTempProviderChanged: (providerId: string) => void
  tempModelPick: string
  setTempModelPick: React.Dispatch<React.SetStateAction<string>>
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
    loading,
    providers,
    roleSessionControlsEnabled,
    tempModelPickerEl,
    closeTempModelPicker,
    tempModelProviderId,
    onTempProviderChanged,
    tempModelPick,
    setTempModelPick,
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

  return (
    <>
      <Popover
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
      </Popover>

      <Popover
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

            <FormControl size="small" fullWidth>
              <InputLabel id="chat-override-provider">供应商</InputLabel>
              <Select
                labelId="chat-override-provider"
                label="供应商"
                value={String(tempModelProviderId || '')}
                onChange={(e) => onTempProviderChanged(String(e.target.value || ''))}
                disabled={loading || !providers.length}
              >
                {providerSelectItems(providers)}
              </Select>
            </FormControl>

            {(() => {
              const pid = String(tempModelProviderId || '')
              const p = providers.find((x: any) => String(x?.id || '') === pid) || null
              const items = registeredModelItems(p)

              return (
                <Stack spacing={1}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="chat-override-model">登记模型</InputLabel>
                    <Select
                      labelId="chat-override-model"
                      label="登记模型"
                      value={String(tempModelPick || '')}
                      onChange={(e) => setTempModelPick(String(e.target.value || ''))}
                      disabled={loading || !pid}
                    >
                      <MenuItem value="">
                        <em>请选择…</em>
                      </MenuItem>
                      {items.map((item: any) => (
                        <MenuItem key={item.id} value={item.id}>
                          {item.hint ? `${item.label} / ${item.hint}` : item.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <Typography variant="caption" color="text.secondary">
                    这里仅显示供应商设置中已登记的模型；原始模型列表请到供应商设置中刷新并登记。
                  </Typography>
                </Stack>
              )
            })()}

            <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
              <Button variant="text" onClick={clearTempModelOverride} disabled={!hasChatOverride || loading}>
                清除临时模型（跟随角色）
              </Button>
              <Button variant="contained" onClick={saveTempModelOverride} disabled={loading || !tempModelProviderId}>
                保存
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Popover>

      <Popover
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
      </Popover>
    </>
  )
}
