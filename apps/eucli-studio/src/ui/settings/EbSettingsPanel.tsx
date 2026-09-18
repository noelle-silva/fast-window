import * as React from 'react'
import { Box, Button, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import CableIcon from '@mui/icons-material/Cable'
import RefreshIcon from '@mui/icons-material/Refresh'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import SaveIcon from '@mui/icons-material/Save'
import { MODEL_REQUEST_TIMEOUT_LIMITS } from '../../controller/modelRequestConfig'
import { compatibilityRangeText, type ReleaseCandidatesView, type StudioBootstrap } from '../../domain/release'
import { useEvent } from '../hooks/useEvent'
import { ReleaseCandidatesPanel } from '../release/ReleaseCandidatesPanel'
import { SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type EbSettingsPanelProps = {
  controller: any
  loading: boolean
  modelRequestConfig: any
  bootstrap?: StudioBootstrap
  releaseView?: ReleaseCandidatesView | null
  releaseBusy?: boolean
  onReleaseRefresh?: (kind?: string) => Promise<void> | void
}

export function EbSettingsPanel(props: EbSettingsPanelProps) {
  const { controller, loading, modelRequestConfig, bootstrap, releaseView, releaseBusy, onReleaseRefresh } = props
  const box = modelRequestConfig && typeof modelRequestConfig === 'object' ? modelRequestConfig : {}
  const draft = box.draft && typeof box.draft === 'object' ? box.draft : {}
  const value = box.value && typeof box.value === 'object' ? box.value : {}
  const busy = loading || !!box.loading || !!box.saving

  React.useEffect(() => {
    controller.actions.refreshModelRequestConfig?.(false)
  }, [controller])

  const refresh = useEvent(() => controller.actions.refreshModelRequestConfig?.(true))
  const save = useEvent(() => controller.actions.saveModelRequestConfig?.())
  const reset = useEvent(() => controller.actions.resetModelRequestConfigDraftToDefaults?.())
  const setDraft = useEvent((key: string, next: string) => controller.actions.setModelRequestConfigDraft?.(key, next))

  return (
    <SettingsSurface>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(14,165,233,.10)', color: 'info.main', display: 'grid', placeItems: 'center' }}>
                <CableIcon fontSize="small" />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 900 }}>e-b 模型请求</Typography>
                  <SettingsPill tone="info">持久化到 e-b</SettingsPill>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  配置模型列表、非流式生成、流式生成三类请求的超时规则。
                </Typography>
              </Box>
            </Stack>

            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button startIcon={<RefreshIcon />} variant="text" onClick={refresh} disabled={busy}>
                {box.loading ? '刷新中…' : '刷新'}
              </Button>
              <Button startIcon={<RestartAltIcon />} variant="text" color="inherit" onClick={reset} disabled={busy}>
                默认值
              </Button>
              <Button startIcon={<SaveIcon />} variant="contained" onClick={save} disabled={busy}>
                {box.saving ? '保存中…' : '保存'}
              </Button>
            </Stack>
          </Stack>

          {bootstrap ? (
            <SettingsSection tone="muted">
              <Stack spacing={1}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <Typography sx={{ fontWeight: 900 }}>版本与连接</Typography>
                  <SettingsPill tone={bootstrap.businessAvailable ? 'selected' : 'danger'}>
                    {bootstrap.businessAvailable ? '适用' : '不可用'}
                  </SettingsPill>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ flexWrap: 'wrap' }}>
                  <ReleaseFact label="客户端版本" value={bootstrap.clientVersion || '版本资料无效'} />
                  <ReleaseFact label="eucli-box 版本" value={bootstrap.eucliBoxVersion || '版本资料无效'} />
                  <ReleaseFact label="客户端所需范围" value={compatibilityRangeText(bootstrap.clientEucliBoxCompatibility)} />
                </Stack>
                {bootstrap.eucliBoxIssue ? (
                  <Typography variant="caption" color="error">{bootstrap.eucliBoxIssue}</Typography>
                ) : null}
              </Stack>
            </SettingsSection>
          ) : null}

          {bootstrap ? (
            <SettingsSection tone="muted">
              <ReleaseCandidatesPanel
                view={releaseView}
                busy={releaseBusy}
                onRefresh={onReleaseRefresh}
              />
            </SettingsSection>
          ) : null}

          <Stack spacing={1.25}>
            <TimeoutField
              label="模型列表总超时"
              description="刷新供应商模型列表时使用。普通 HTTP 请求超过这个总时长就失败。"
              value={String(draft.listModelsTimeoutSec ?? '')}
              savedMs={value.listModelsTimeoutMs}
              minMs={MODEL_REQUEST_TIMEOUT_LIMITS.listModels.minMs}
              maxMs={MODEL_REQUEST_TIMEOUT_LIMITS.listModels.maxMs}
              defaultMs={MODEL_REQUEST_TIMEOUT_LIMITS.listModels.defaultMs}
              disabled={busy}
              onChange={(next) => setDraft('listModelsTimeoutSec', next)}
            />

            <TimeoutField
              label="非流式生成总超时"
              description="关闭流式输出时使用。因为没有中间进度，只能按完整响应总时长判断。"
              value={String(draft.completionTimeoutSec ?? '')}
              savedMs={value.completionTimeoutMs}
              minMs={MODEL_REQUEST_TIMEOUT_LIMITS.completion.minMs}
              maxMs={MODEL_REQUEST_TIMEOUT_LIMITS.completion.maxMs}
              defaultMs={MODEL_REQUEST_TIMEOUT_LIMITS.completion.defaultMs}
              disabled={busy}
              onChange={(next) => setDraft('completionTimeoutSec', next)}
            />

            <TimeoutField
              label="流式空闲超时"
              description="开启流式输出时使用。只要持续收到模型数据就不会按总时长截断；长时间没有新数据才失败。"
              value={String(draft.streamIdleTimeoutSec ?? '')}
              savedMs={value.streamIdleTimeoutMs}
              minMs={MODEL_REQUEST_TIMEOUT_LIMITS.streamIdle.minMs}
              maxMs={MODEL_REQUEST_TIMEOUT_LIMITS.streamIdle.maxMs}
              defaultMs={MODEL_REQUEST_TIMEOUT_LIMITS.streamIdle.defaultMs}
              disabled={busy}
              onChange={(next) => setDraft('streamIdleTimeoutSec', next)}
            />
          </Stack>

          {box.error ? <Typography variant="body2" color="error">{String(box.error || '')}</Typography> : null}
          {box.saveError ? <Typography variant="body2" color="error">{String(box.saveError || '')}</Typography> : null}

          <SettingsSection tone="muted">
            <Typography variant="caption" color="text.secondary">
              这些配置由 e-b 后端保存并在模型请求发起时读取；客户端只负责提供入口，不再用自己的总等待时长截断模型运行。
            </Typography>
          </SettingsSection>
        </Stack>
    </SettingsSurface>
  )
}

function ReleaseFact(props: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: { xs: 0, sm: 180 }, flex: '1 1 180px' }}>
      <Typography variant="caption" color="text.secondary">{props.label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{props.value}</Typography>
    </Box>
  )
}

function TimeoutField(props: {
  label: string
  description: string
  value: string
  savedMs: unknown
  minMs: number
  maxMs: number
  defaultMs: number
  disabled: boolean
  onChange: (value: string) => void
}) {
  const savedText = secondsText(props.savedMs)
  return (
    <SettingsSection>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 900 }}>{props.label}</Typography>
            <SettingsPill>默认 {Math.round(props.defaultMs / 1000)} 秒</SettingsPill>
            {savedText ? <SettingsPill tone="info">已保存 {savedText}</SettingsPill> : null}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {props.description}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            范围：{Math.round(props.minMs / 1000)}-{Math.round(props.maxMs / 1000)} 秒。
          </Typography>
        </Box>
        <TextField
          size="small"
          label="秒"
          type="number"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          inputProps={{ min: Math.round(props.minMs / 1000), max: Math.round(props.maxMs / 1000), step: 1 }}
          InputProps={{ endAdornment: <InputAdornment position="end">秒</InputAdornment> }}
          disabled={props.disabled}
          sx={{ width: { xs: '100%', sm: 180 } }}
        />
      </Stack>
    </SettingsSection>
  )
}

function secondsText(value: unknown) {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return `${Math.round(ms / 1000)} 秒`
}
