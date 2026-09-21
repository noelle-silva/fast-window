import * as React from 'react'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { collectErrorOrigins, normalizeErrorPayload, type ErrorPayload } from '../../domain/errorPayload'
import { ErrorKindChip } from './ErrorKindChip'
import { ErrorTraceDialog } from './ErrorTraceDialog'

function ErrorOriginItem(props: { error: ErrorPayload }) {
  const code = String(props.error.code || '').trim()
  const system = String(props.error.system || '').trim()
  const message = String(props.error.message || '').trim()
  const meta = [system, code].filter(Boolean).join(' / ')

  return (
    <Stack direction="row" spacing={0.75} alignItems="flex-start" sx={{ minWidth: 0 }}>
      <Box sx={{ pt: 0.25 }}>
        <ErrorKindChip code={code} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontWeight: 700 }}>
          {message}
        </Typography>
        {meta ? (
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {meta}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  )
}

export function AssistantErrorNotice(props: { error: unknown; title?: string }) {
  const [detailOpen, setDetailOpen] = React.useState(false)
  const raw = normalizeErrorPayload(props.error)
  if (!raw) return null
  const title = String(props.title || '请求失败追溯链').trim()
  const origins = collectErrorOrigins(raw)

  return (
    <>
      <Alert
        severity="error"
        variant="outlined"
        sx={{ borderRadius: 2, alignItems: 'flex-start' }}
        action={
          <Button size="small" variant="outlined" color="error" onClick={() => setDetailOpen(true)} sx={{ borderRadius: 2, minWidth: 0, px: 1.25 }}>
            详情
          </Button>
        }
      >
        <Stack spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
            {title}
          </Typography>
          <Stack spacing={0.75}>
            {origins.map((origin, index) => (
              <ErrorOriginItem key={`${origin.code || ''}:${origin.message}:${index}`} error={origin} />
            ))}
          </Stack>
        </Stack>
      </Alert>
      <ErrorTraceDialog open={detailOpen} title={title} error={raw} rawError={props.error} onClose={() => setDetailOpen(false)} />
    </>
  )
}
