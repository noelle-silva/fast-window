import { Box, Chip, Stack, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { applyCandidate } from './commandSuggest'
import { describeResult } from './executionCopy'
import type { OutcomeTone } from './executionCopy'
import type { DevConsoleExecution } from './useDevConsole'

type ExecutionListProps = {
  executions: DevConsoleExecution[]
  onPickCandidate: (nextInput: string) => void
}

export default function ExecutionList({ executions, onPickCandidate }: ExecutionListProps) {
  if (executions.length === 0) {
    return (
      <Box sx={{ py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          还没有执行记录。输入一条命令，宿主会在这里留下每个应用的真实结局。
        </Typography>
      </Box>
    )
  }

  return (
    <Stack spacing={0}>
      {executions.map(execution => (
        <ExecutionRow
          key={execution.id}
          execution={execution}
          onPickCandidate={onPickCandidate}
        />
      ))}
    </Stack>
  )
}

type ExecutionRowProps = {
  execution: DevConsoleExecution
  onPickCandidate: (nextInput: string) => void
}

function ExecutionRow({ execution, onPickCandidate }: ExecutionRowProps) {
  const response = execution.response
  const error = execution.error

  return (
    <Box sx={{ py: 1.1, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography
          variant="caption"
          sx={{ fontFamily: 'monospace', color: 'text.secondary', minWidth: 62 }}
        >
          {formatTime(execution.at)}
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
          {execution.command}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <ExecutionBadge execution={execution} />
      </Stack>

      {response ? (
        <Stack spacing={0.4} sx={{ mt: 0.75, pl: '70px' }}>
          {response.results.map(result => {
            const copy = describeResult(response.action, result)
            return (
              <Stack
                key={result.appId}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}
              >
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {result.name}
                </Typography>
                <Typography variant="caption" sx={{ color: toneColor(copy.tone) }}>
                  {copy.text}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                  {result.durationMs} ms
                </Typography>
              </Stack>
            )
          })}
          {response.results.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              没有正在运行的目标应用。
            </Typography>
          ) : null}
        </Stack>
      ) : null}

      {error ? (
        <Box sx={{ mt: 0.75, pl: '70px' }}>
          <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
            {error.message}
          </Typography>
          {error.candidates && error.candidates.length > 0 ? (
            <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {error.candidates.map(candidate => (
                <Chip
                  key={candidate.appId}
                  size="small"
                  label={candidate.name}
                  onClick={() => onPickCandidate(applyCandidate(execution.command, candidate.appId))}
                />
              ))}
            </Stack>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

function ExecutionBadge({ execution }: { execution: DevConsoleExecution }) {
  if (execution.phase === 'running') {
    return <Chip size="small" variant="outlined" label="执行中" />
  }
  if (execution.phase === 'failed') {
    return <Chip size="small" color="error" variant="outlined" label="被拒绝" />
  }
  return <Chip size="small" color="success" variant="outlined" label="已受理" />
}

function toneColor(tone: OutcomeTone) {
  return (theme: Theme) => {
    switch (tone) {
      case 'success':
        return theme.palette.success.dark
      case 'warning':
        return theme.palette.warning.dark
      case 'error':
        return theme.palette.error.main
      case 'muted':
        return theme.palette.text.secondary
    }
  }
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false })
}
