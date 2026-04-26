import { Box, Typography } from '@mui/material'
import { formatBackendStatus, type PluginBackendStatus } from './backendStatus'

export function BackendStatusPanel(props: {
  status?: PluginBackendStatus | null
  labelSx: object
  valueSx: object
  fieldRowSx: object
}) {
  const { status, labelSx, valueSx, fieldRowSx } = props
  const logText = status ? `${status.stdout || ''}${status.stderr ? `\n[stderr]\n${status.stderr}` : ''}` : ''

  return (
    <>
      <Box sx={fieldRowSx}>
        <Typography sx={labelSx}>后台状态</Typography>
        <Typography sx={valueSx}>{formatBackendStatus(status)}</Typography>
      </Box>
      {status && logText ? (
        <Box sx={{ mt: 1.25 }}>
          <Typography sx={{ color: 'text.secondary', fontSize: 13, mb: 0.5 }}>后台日志</Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              maxHeight: 160,
              overflow: 'auto',
              borderRadius: 1,
              bgcolor: 'action.hover',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {logText}
          </Box>
          {status.stdoutTruncated || status.stderrTruncated ? (
            <Typography variant="caption" color="text.secondary">日志已截断</Typography>
          ) : null}
        </Box>
      ) : null}
    </>
  )
}
