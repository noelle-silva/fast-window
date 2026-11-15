import { useMemo, useState } from 'react'
import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material'
import { applyCandidate, suggestAppCandidates } from './commandSuggest'
import AppCatalogList from './AppCatalogList'
import ExecutionList from './ExecutionList'
import { useDevConsole } from './useDevConsole'

const COMMAND_HINT = 'stop · kill · start · restart · status · list'
const TARGET_HINT = 'folder <应用> · info <应用> · --all 批量'

export default function DevConsoleApp() {
  const { apps, statuses, serverStatus, executions, run } = useDevConsole()
  const [input, setInput] = useState('')

  const candidates = useMemo(
    () => suggestAppCandidates(input, apps),
    [apps, input],
  )

  function submit() {
    const trimmed = input.trim()
    if (!trimmed) return
    void run(trimmed)
    setInput('')
  }

  function pickCandidate(nextInput: string) {
    setInput(nextInput)
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Dev 控制台
        </Typography>
        <Box sx={{ flex: 1 }} />
        <ServerBadge port={serverStatus?.port ?? null} listening={serverStatus?.listening ?? false} error={serverStatus?.error} />
      </Box>

      <Box sx={{ px: 2, pt: 1.75, pb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="stop venera"
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
              if (event.key === 'Tab' && candidates.length > 0) {
                event.preventDefault()
                setInput(applyCandidate(input, candidates[0].id))
              }
            }}
            sx={{ '& .MuiOutlinedInput-root': { fontFamily: 'monospace' } }}
          />
          <Button variant="contained" onClick={submit} sx={{ textTransform: 'none', minWidth: 72 }}>
            执行
          </Button>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          {COMMAND_HINT}
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>
          {TARGET_HINT}
        </Typography>

        {candidates.length > 0 ? (
          <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
            {candidates.map(candidate => (
              <Chip
                key={candidate.id}
                size="small"
                variant="outlined"
                label={candidate.name}
                onClick={() => pickCandidate(applyCandidate(input, candidate.id))}
              />
            ))}
          </Stack>
        ) : null}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2 }}>
        <ExecutionList executions={executions} onPickCandidate={pickCandidate} />
      </Box>

      <Box sx={{ px: 2, py: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
        <AppCatalogList
          apps={apps}
          statuses={statuses}
          onPick={appId => pickCandidate(`stop ${appId}`)}
        />
      </Box>
    </Box>
  )
}

function ServerBadge({
  port,
  listening,
  error,
}: {
  port: number | null
  listening: boolean
  error?: string
}) {
  if (listening && port !== null) {
    return (
      <Chip
        size="small"
        color="success"
        variant="outlined"
        label={`脚本入口 127.0.0.1:${port}`}
      />
    )
  }

  return (
    <Chip
      size="small"
      color={error ? 'error' : 'default'}
      variant="outlined"
      title={error}
      label={error ? '脚本入口启动失败' : '脚本入口未启动'}
    />
  )
}
