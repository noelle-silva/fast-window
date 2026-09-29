import * as React from 'react'
import { Box, Button, FormControlLabel, InputAdornment, Stack, Switch, TextField, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import SaveIcon from '@mui/icons-material/Save'
import TuneIcon from '@mui/icons-material/Tune'
import { MODEL_REQUEST_TIMEOUT_LIMITS } from '../../controller/modelRequestConfig'
import { CONVERSATION_IMAGE_LIMITS } from '../../controller/conversationImageConfig'
import { useEvent } from '../hooks/useEvent'
import { SettingsHeading, SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type SessionSettingsPanelProps = {
  controller: any
  loading: boolean
  modelRequestConfig: any
  conversationImageConfig: any
}

export function SessionSettingsPanel(props: SessionSettingsPanelProps) {
  const { controller, loading, modelRequestConfig, conversationImageConfig } = props
  const box = modelRequestConfig && typeof modelRequestConfig === 'object' ? modelRequestConfig : {}
  const draft = box.draft && typeof box.draft === 'object' ? box.draft : {}
  const value = box.value && typeof box.value === 'object' ? box.value : {}
  const busy = loading || !!box.loading || !!box.saving

  React.useEffect(() => {
    controller.actions.refreshModelRequestConfig?.(false)
    controller.actions.refreshConversationImageConfig?.(false)
  }, [controller])

  const refresh = useEvent(() => controller.actions.refreshModelRequestConfig?.(true))
  const save = useEvent(() => controller.actions.saveModelRequestConfig?.())
  const reset = useEvent(() => controller.actions.resetModelRequestConfigDraftToDefaults?.())
  const setDraft = useEvent((key: string, next: string) => controller.actions.setModelRequestConfigDraft?.(key, next))

  const imageBox = conversationImageConfig && typeof conversationImageConfig === 'object' ? conversationImageConfig : {}
  const imageDraft = imageBox.draft && typeof imageBox.draft === 'object' ? imageBox.draft : {}
  const imageValue = imageBox.value && typeof imageBox.value === 'object' ? imageBox.value : {}
  const imageBusy = loading || !!imageBox.loading || !!imageBox.saving
  const multiVersionEnabled = imageDraft.multiVersionEnabled !== false
  const originalBudgetEnabled = multiVersionEnabled && imageDraft.originalBudgetEnabled !== false
  const historyBudgetEnabled = multiVersionEnabled && imageDraft.historyBudgetEnabled !== false

  const refreshImages = useEvent(() => controller.actions.refreshConversationImageConfig?.(true))
  const saveImages = useEvent(() => controller.actions.saveConversationImageConfig?.())
  const resetImages = useEvent(() => controller.actions.resetConversationImageConfigDraftToDefaults?.())
  const setImageDraft = useEvent((field: string, next: any) => controller.actions.setConversationImageConfigDraft?.(field, next))

  return (
    <SettingsSurface>
      <Stack spacing={2}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(25,118,210,.10)', color: 'primary.main', display: 'grid', placeItems: 'center' }}>
                <TuneIcon fontSize="small" />
              </Box>
              <SettingsHeading title="会话设置" description="配置模型列表、非流式生成、流式生成三类请求的超时规则。" descriptionVariant="body2" />
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
        </Stack>

        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(46,125,50,.10)', color: 'success.main', display: 'grid', placeItems: 'center' }}>
                <TuneIcon fontSize="small" />
              </Box>
              <SettingsHeading title="会话图片" description="配置发往模型的图片发送策略：存图保留小副本，只作用于请求体，不改变聊天展示。" descriptionVariant="body2" />
            </Stack>

            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button startIcon={<RefreshIcon />} variant="text" onClick={refreshImages} disabled={imageBusy}>
                {imageBox.loading ? '刷新中…' : '刷新'}
              </Button>
              <Button startIcon={<RestartAltIcon />} variant="text" color="inherit" onClick={resetImages} disabled={imageBusy}>
                默认值
              </Button>
              <Button startIcon={<SaveIcon />} variant="contained" onClick={saveImages} disabled={imageBusy}>
                {imageBox.saving ? '保存中…' : '保存'}
              </Button>
            </Stack>
          </Stack>

          <Stack spacing={1.25}>
            <SettingsSection>
              <FormControlLabel
                sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                control={<Switch size="small" checked={multiVersionEnabled} onChange={(event) => setImageDraft('multiVersionEnabled', event.target.checked)} />}
                label={
                  <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                      <Typography sx={{ fontWeight: 900 }}>多版本存图</Typography>
                      <SettingsPill tone="info">默认开启</SettingsPill>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">存图时保留原图，另存一张压缩小副本；聊天展示用原图，发模型默认用小副本。</Typography>
                  </Stack>
                }
              />
            </SettingsSection>

            <SettingsSection>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <FormControlLabel
                    sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                    control={<Switch size="small" checked={originalBudgetEnabled} disabled={!multiVersionEnabled} onChange={(event) => setImageDraft('originalBudgetEnabled', event.target.checked)} />}
                    label={
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                          <Typography sx={{ fontWeight: 900 }}>原图预算</Typography>
                          <SettingsPill tone="info">默认开启</SettingsPill>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">最近的若干张图片以原图形式发送给模型；依赖多版本存图开启。</Typography>
                      </Stack>
                    }
                  />
                </Box>
                <TextField
                  size="small"
                  label="张"
                  type="number"
                  value={String(imageDraft.originalBudgetCount ?? '')}
                  onChange={(event) => setImageDraft('originalBudgetCount', event.target.value)}
                  inputProps={{ min: CONVERSATION_IMAGE_LIMITS.originalBudget.min, max: CONVERSATION_IMAGE_LIMITS.originalBudget.max, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">张</InputAdornment> }}
                  disabled={imageBusy || !originalBudgetEnabled}
                  sx={{ width: { xs: '100%', sm: 180 } }}
                />
              </Stack>
            </SettingsSection>

            <SettingsSection>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <FormControlLabel
                    sx={{ m: 0, width: '100%', alignItems: 'flex-start' }}
                    control={<Switch size="small" checked={historyBudgetEnabled} disabled={!multiVersionEnabled} onChange={(event) => setImageDraft('historyBudgetEnabled', event.target.checked)} />}
                    label={
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                          <Typography sx={{ fontWeight: 900 }}>历史图片预算</Typography>
                          <SettingsPill tone="info">默认开启</SettingsPill>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">发模型只带最近若干张图，超出的用占位文字替代并注明图片 ID；依赖多版本存图开启。</Typography>
                      </Stack>
                    }
                  />
                </Box>
                <TextField
                  size="small"
                  label="张"
                  type="number"
                  value={String(imageDraft.historyBudgetCount ?? '')}
                  onChange={(event) => setImageDraft('historyBudgetCount', event.target.value)}
                  inputProps={{ min: CONVERSATION_IMAGE_LIMITS.historyBudget.min, max: CONVERSATION_IMAGE_LIMITS.historyBudget.max, step: 1 }}
                  InputProps={{ endAdornment: <InputAdornment position="end">张</InputAdornment> }}
                  disabled={imageBusy || !historyBudgetEnabled}
                  sx={{ width: { xs: '100%', sm: 180 } }}
                />
              </Stack>
            </SettingsSection>
          </Stack>

          {imageBox.error ? <Typography variant="body2" color="error">{String(imageBox.error || '')}</Typography> : null}
          {imageBox.saveError ? <Typography variant="body2" color="error">{String(imageBox.saveError || '')}</Typography> : null}
        </Stack>
      </Stack>
    </SettingsSurface>
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
