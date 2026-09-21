import * as React from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { ErrorPayload } from '../../domain/errorPayload'
import { prettyJsonText } from '../utils/text'
import { CustomScrollArea } from './CustomScrollArea'
import { ErrorKindChip, errorKindStyle } from './ErrorKindChip'

export function ErrorTraceTree(props: { error: ErrorPayload; depth?: number }) {
  const depth = props.depth || 0
  const code = String(props.error.code || '').trim()
  const system = String(props.error.system || '').trim()
  const message = String(props.error.message || '').trim()
  const details = prettyJsonText(props.error.details)
  const cause = props.error.cause || null
  const causes = Array.isArray(props.error.causes) ? props.error.causes : []
  const kind = errorKindStyle(code)

  return (
    <Stack spacing={0.75} sx={{ pl: depth ? 1.5 : 0, borderLeft: depth ? '2px solid rgba(0,0,0,.08)' : 'none' }}>
      <Box sx={{ borderRadius: 1.5, p: 1, bgcolor: kind.bg }}>
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
            <ErrorKindChip code={code} />
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
      {cause ? <ErrorTraceTree error={cause} depth={depth + 1} /> : null}
      {causes.length ? (
        <Stack spacing={0.75} sx={{ pl: 1.5, borderLeft: '2px solid rgba(0,0,0,.08)' }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 900 }}>
            并列原因
          </Typography>
          {causes.map((item, index) => <ErrorTraceTree key={`${depth}-${index}-${item.code || item.message}`} error={item} depth={depth + 1} />)}
        </Stack>
      ) : null}
    </Stack>
  )
}
