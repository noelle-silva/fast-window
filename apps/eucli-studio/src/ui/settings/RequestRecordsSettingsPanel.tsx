import * as React from 'react'
import { Box, Button, Stack, Switch, TextField, Typography } from '@mui/material'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { SettingsHeading, SettingsSection, SettingsSurface } from './SettingsSurfaces'
import { REQUEST_RECORD_LIMIT_MAX, REQUEST_RECORD_LIMIT_MIN } from '../../controller/requestRecords'

type RequestRecordsSettingsPanelProps = {
  controller: any
  loading: boolean
  requestRecords: any
}

export function RequestRecordsSettingsPanel(props: RequestRecordsSettingsPanelProps) {
  const { controller, loading, requestRecords } = props
  const box = requestRecords || {}
  const config = box.config || {}
  const items = Array.isArray(box.items) ? box.items : []
  const selectedId = String(box.selectedId || '')
  const detail = box.detail

  React.useEffect(() => {
    controller.actions.refreshRequestRecordConfig?.(false)
    controller.actions.refreshRequestRecords?.(true)
  }, [controller])

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <SettingsHeading title="请求记录" description="记录发往模型供应商的请求与响应原文，用于排查模型调用问题。" />
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 800 }}>启用记录</Typography>
            <Switch
              size="small"
              checked={!!config.enabled}
              disabled={loading || !!box.configSaving}
              onChange={(e) => controller.actions.setRequestRecordEnabled?.(e.target.checked)}
            />
          </Stack>
          <TextField
            size="small"
            label="保留条数"
            type="number"
            value={box.limitDraft ?? ''}
            disabled={loading || !!box.configSaving}
            onChange={(e) => controller.actions.setRequestRecordLimitDraft?.(e.target.value)}
            onBlur={() => controller.actions.commitRequestRecordLimit?.()}
            slotProps={{ htmlInput: { min: REQUEST_RECORD_LIMIT_MIN, max: REQUEST_RECORD_LIMIT_MAX } }}
            sx={{ width: 120 }}
          />
          {box.configError ? <Typography variant="body2" color="error">{String(box.configError)}</Typography> : null}
        </Stack>

        {box.error ? <Typography variant="body2" color="error">{String(box.error)}</Typography> : null}

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 260, lg: 300 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>请求列表</Typography>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <Stack spacing={1}>
                  {items.length ? items.map((item: any) => {
                    const id = String(item?.id || '')
                    const selected = !!id && id === selectedId
                    return (
                      <Button
                        key={id}
                        variant={selected ? 'contained' : 'text'}
                        color={selected ? 'primary' : 'inherit'}
                        onClick={() => controller.actions.openRequestRecord?.(id)}
                        disabled={!id}
                        sx={{ justifyContent: 'flex-start', minWidth: 0, width: '100%', textTransform: 'none', textAlign: 'left' }}
                      >
                        <Box sx={{ minWidth: 0, width: '100%' }}>
                          <Box component="span" sx={{ display: 'block', fontSize: 12, fontWeight: 800 }}>{formatRecordTime(item?.createdAt)}</Box>
                          <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'text.secondary' }}>
                            {formatRecordStatus(item)} · {String(item?.method || '')} {String(item?.url || '')}
                          </Box>
                        </Box>
                      </Button>
                    )
                  }) : <Typography variant="body2" color="text.secondary">{box.loading ? '加载中…' : '暂无请求记录。'}</Typography>}
                </Stack>
              </Box>
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }}>
              {box.detailLoading ? (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">加载中…</Typography>
                </SettingsSection>
              ) : box.detailError ? (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="error">{String(box.detailError)}</Typography>
                </SettingsSection>
              ) : detail ? (
                <RequestRecordDetail record={detail} />
              ) : (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">选择一条记录查看请求与响应原文。</Typography>
                </SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>
      </Stack>
    </SettingsSurface>
  )
}

function RequestRecordDetail({ record }: { record: any }) {
  const error = String(record?.error || '')
  return (
    <SettingsSection>
      <Stack spacing={1.5}>
        <Typography variant="body2" sx={{ fontWeight: 900 }}>请求</Typography>
        <RecordField label="时间" text={formatRecordTime(record?.createdAt)} />
        <RecordField label="方法 / 地址" text={`${String(record?.method || '')} ${String(record?.url || '')}`} />
        <RecordTextBlock label="请求头" text={formatHeaders(record?.headers)} />
        <RecordTextBlock label="请求体" text={String(record?.body || '')} />

        <Typography variant="body2" sx={{ fontWeight: 900 }}>响应</Typography>
        <RecordField label="状态" text={formatRecordStatus({ status: record?.responseStatus })} />
        {typeof record?.durationMs === 'number' ? <RecordField label="耗时" text={`${record.durationMs} ms`} /> : null}
        {error ? <RecordTextBlock label="错误" text={error} /> : null}
        <RecordTextBlock label="响应头" text={formatHeaders(record?.responseHeaders)} />
        <RecordTextBlock label="响应体" text={String(record?.responseBody || '')} />
      </Stack>
    </SettingsSection>
  )
}

function RecordField({ label, text }: { label: string; text: string }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.5 }}>{label}</Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{text}</Typography>
    </Box>
  )
}

function RecordTextBlock({ label, text }: { label: string; text: string }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.5 }}>{label}</Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          borderRadius: 1,
          bgcolor: 'action.hover',
          fontSize: 12,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 320,
          overflow: 'auto',
        }}
      >
        {text || '（空）'}
      </Box>
    </Box>
  )
}

function formatRecordTime(value: any) {
  const time = new Date(String(value || ''))
  if (Number.isNaN(time.getTime())) return ''
  return time.toLocaleString()
}

function formatRecordStatus(item: any) {
  const status = Number(item?.status ?? item?.responseStatus ?? 0)
  if (status > 0) return String(status)
  return item?.error ? '失败' : '—'
}

function formatHeaders(headers: any) {
  if (!headers || typeof headers !== 'object') return ''
  const lines: string[] = []
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${String(item)}`)
    } else {
      lines.push(`${name}: ${String(value)}`)
    }
  }
  return lines.join('\n')
}
