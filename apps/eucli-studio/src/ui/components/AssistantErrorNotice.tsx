import * as React from 'react'
import { Alert, Box, Chip, Stack, Typography } from '@mui/material'
import { normalizeErrorPayload, normalizeErrorPayloads, type ErrorPayload } from '../../domain/errorPayload'
import { CustomScrollArea } from './CustomScrollArea'

function stringifyDetails(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch (_) {
    return String(value)
  }
}

function errorKind(code: string) {
  if (!code) return { label: '原始原因', color: '#64748b', bg: 'rgba(100,116,139,.08)' }
  if (code.startsWith('network.')) return { label: '网络异常', color: '#d97706', bg: 'rgba(217,119,6,.08)' }
  if (code === 'provider.service_failed') return { label: '上游返回', color: '#2563eb', bg: 'rgba(37,99,235,.08)' }
  if (code.startsWith('provider.')) return { label: '模型请求', color: '#7c3aed', bg: 'rgba(124,58,237,.08)' }
  if (code.startsWith('runtime.')) return { label: '运行阶段', color: '#475569', bg: 'rgba(71,85,105,.08)' }
  if (code.startsWith('gateway.')) return { label: '网关阶段', color: '#475569', bg: 'rgba(71,85,105,.08)' }
  if (code.startsWith('storage.')) return { label: '存储异常', color: '#dc2626', bg: 'rgba(220,38,38,.08)' }
  return { label: '内部错误', color: '#dc2626', bg: 'rgba(220,38,38,.08)' }
}

function ErrorNode(props: { error: ErrorPayload; depth?: number }) {
  const depth = props.depth || 0
  const code = String(props.error.code || '').trim()
  const system = String(props.error.system || '').trim()
  const message = String(props.error.message || '').trim()
  const details = stringifyDetails(props.error.details)
  const cause = normalizeErrorPayload(props.error.cause)
  const causes = normalizeErrorPayloads(props.error.causes)
  const kind = errorKind(code)

  return (
    <Stack spacing={0.75} sx={{ pl: depth ? 1.5 : 0, borderLeft: depth ? '2px solid rgba(0,0,0,.08)' : 'none' }}>
      <Box sx={{ borderRadius: 1.5, p: 1, bgcolor: kind.bg }}>
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
            <Chip
              label={kind.label}
              size="small"
              sx={{ height: 20, fontSize: 11, fontWeight: 900, color: kind.color, bgcolor: 'rgba(255,255,255,.72)' }}
            />
            {code || system ? (
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {[system, code].filter(Boolean).join(' / ')}
              </Typography>
            ) : null}
          </Stack>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontWeight: depth ? 600 : 800 }}>
            {message}
          </Typography>
          {details ? (
            <Box component="details" sx={{ mt: 0.25 }}>
              <Box component="summary" sx={{ cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                原始错误详情
              </Box>
              <CustomScrollArea hostSx={{ mt: 0.75, maxHeight: 260, borderRadius: 1.5, bgcolor: 'rgba(0,0,0,.04)' }} scrollSx={{ maxHeight: 260 }}>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: 12,
                    p: 1,
                  }}
                >
                  {details}
                </Box>
              </CustomScrollArea>
            </Box>
          ) : null}
        </Stack>
      </Box>
      {cause ? <ErrorNode error={cause} depth={depth + 1} /> : null}
      {causes.length ? (
        <Stack spacing={0.75} sx={{ pl: 1.5, borderLeft: '2px solid rgba(0,0,0,.08)' }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 900 }}>
            并列原因
          </Typography>
          {causes.map((item, index) => <ErrorNode key={`${depth}-${index}-${item.code || item.message}`} error={item} depth={depth + 1} />)}
        </Stack>
      ) : null}
    </Stack>
  )
}

export function AssistantErrorNotice(props: { error: any; title?: string }) {
  const raw = normalizeErrorPayload(props.error)
  if (!raw) return null
  const title = String(props.title || '请求失败追溯链').trim()

  return (
    <Alert severity="error" variant="outlined" sx={{ borderRadius: 2, alignItems: 'flex-start' }}>
      <Stack spacing={0.75} sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
          {title}
        </Typography>
        <ErrorNode error={raw} />
      </Stack>
    </Alert>
  )
}
