import * as React from 'react'
import { Box, Button, Stack, Switch, TextField, Typography } from '@mui/material'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { SettingsHeading, SettingsSection, SettingsSurface } from './SettingsSurfaces'
import { formatJsonText } from './requestRecordFormat'
import { KeyValueView, RecordTextView, RequestPayloadView, ResponseStreamView } from './RequestRecordViews'
import { parseRequestPayloadText, parseResponseStreamText, type RequestPayloadView as RequestPayloadViewModel, type ResponseStreamView as ResponseStreamViewModel } from './requestRecordParse'
import { REQUEST_RECORD_LIMIT_MAX, REQUEST_RECORD_LIMIT_MIN } from '../../controller/requestRecords'

type HeaderEntry = { key: string; value: string }

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
                  <Typography variant="body2" color="text.secondary">选择一条记录查看请求与响应。</Typography>
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
  const requestHeaders = headerEntries(record?.headers)
  const responseHeaders = responseHeaderEntries(record?.responseHeaders)
  const bodyText = String(record?.body || '')
  const responseText = String(record?.responseBody || '')
  const payload = React.useMemo(() => parseRequestPayloadText(bodyText), [bodyText])
  const stream = React.useMemo(() => parseResponseStreamText(responseText), [responseText])
  const bodyFormatted = React.useMemo(() => formatJsonText(bodyText), [bodyText])
  const error = String(record?.error || '')
  return (
    <SettingsSection>
      <Stack spacing={1.5}>
        <Typography variant="body2" sx={{ fontWeight: 900 }}>请求</Typography>
        <RecordField label="时间" text={formatRecordTime(record?.createdAt)} />
        <RecordField label="方法 / 地址" text={`${String(record?.method || '')} ${String(record?.url || '')}`} />
        <HeaderDetailBlock label="请求头" entries={requestHeaders} />
        <PayloadDetailBlock label="请求体" payload={payload} bodyText={bodyText} formattedText={bodyFormatted} />

        <Typography variant="body2" sx={{ fontWeight: 900 }}>响应</Typography>
        <RecordField label="状态" text={formatRecordStatus({ status: record?.responseStatus })} />
        {typeof record?.durationMs === 'number' ? <RecordField label="耗时" text={`${record.durationMs} ms`} /> : null}
        {error ? <RecordField label="错误" text={error} /> : null}
        <HeaderDetailBlock label="响应头" entries={responseHeaders} />
        <StreamDetailBlock label="响应体" stream={stream} responseText={responseText} />
      </Stack>
    </SettingsSection>
  )
}

function DetailBlock({ label, toggle, children }: { label: string; toggle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 800 }}>{label}</Typography>
        {toggle}
      </Box>
      {children}
    </Box>
  )
}

function DetailToggle({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      size="small"
      variant="text"
      onClick={onClick}
      sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: 12, textTransform: 'none' }}
    >
      {label}
    </Button>
  )
}

function HeaderDetailBlock({ label, entries }: { label: string; entries: HeaderEntry[] }) {
  const [showRaw, setShowRaw] = React.useState(false)
  const rawText = entries.map((entry) => `${entry.key}: ${entry.value}`).join('\n')
  React.useEffect(() => {
    setShowRaw(false)
  }, [rawText])
  if (!entries.length) {
    return <DetailBlock label={label}><RecordTextView text="" /></DetailBlock>
  }
  return (
    <DetailBlock label={label} toggle={<DetailToggle label={showRaw ? '界面渲染' : '查看原文'} onClick={() => setShowRaw((current) => !current)} />}>
      {showRaw ? <RecordTextView text={rawText} /> : <KeyValueView entries={entries} />}
    </DetailBlock>
  )
}

function PayloadDetailBlock({ label, payload, bodyText, formattedText }: { label: string; payload: RequestPayloadViewModel | null; bodyText: string; formattedText: string | null }) {
  const [showFormatted, setShowFormatted] = React.useState(false)
  React.useEffect(() => {
    setShowFormatted(false)
  }, [bodyText])
  if (!payload) {
    return <DetailBlock label={label}><RecordTextView text={formattedText ?? bodyText} /></DetailBlock>
  }
  return (
    <DetailBlock label={label} toggle={<DetailToggle label={showFormatted ? '界面渲染' : '查看格式化'} onClick={() => setShowFormatted((current) => !current)} />}>
      {showFormatted ? <RecordTextView text={formattedText ?? bodyText} /> : <RequestPayloadView view={payload} />}
    </DetailBlock>
  )
}

function StreamDetailBlock({ label, stream, responseText }: { label: string; stream: ResponseStreamViewModel | null; responseText: string }) {
  const [showRaw, setShowRaw] = React.useState(false)
  React.useEffect(() => {
    setShowRaw(false)
  }, [responseText])
  if (!stream) {
    return <DetailBlock label={label}><RecordTextView text={responseText} /></DetailBlock>
  }
  return (
    <DetailBlock label={label} toggle={<DetailToggle label={showRaw ? '界面渲染' : '查看原文'} onClick={() => setShowRaw((current) => !current)} />}>
      {showRaw ? <RecordTextView text={responseText} /> : <ResponseStreamView view={stream} />}
    </DetailBlock>
  )
}

function RecordField({ label, text }: { label: string; text: string }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.5 }}>{label}</Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'break-word' }}>{text}</Typography>
    </Box>
  )
}

function headerEntries(headers: any): HeaderEntry[] {
  if (!headers || typeof headers !== 'object') return []
  return Object.entries(headers).map(([key, value]) => ({ key, value: String(value ?? '') }))
}

function responseHeaderEntries(headers: any): HeaderEntry[] {
  if (!headers || typeof headers !== 'object') return []
  return Object.entries(headers).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? value.map((item) => String(item)).join('\n') : String(value ?? ''),
  }))
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
