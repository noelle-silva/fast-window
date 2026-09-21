import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogTitle, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { ErrorPayload } from '../../domain/errorPayload'
import { prettyJsonText } from '../utils/text'
import { ErrorTraceTree } from './ErrorTraceTree'
import { ScrollableDialogContent } from './ScrollableDialogContent'

type ErrorTraceView = 'trace' | 'raw'

type ErrorTraceDialogProps = {
  open: boolean
  title: string
  error: ErrorPayload
  rawError: unknown
  onClose: () => void
}

export function ErrorTraceDialog(props: ErrorTraceDialogProps) {
  const [view, setView] = React.useState<ErrorTraceView>('trace')
  const { open, title, error, rawError, onClose } = props

  React.useEffect(() => {
    if (open) setView('trace')
  }, [open])

  const rawText = React.useMemo(() => prettyJsonText(rawError), [rawError])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography component="span" sx={{ fontWeight: 900, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_event, next: ErrorTraceView | null) => {
            if (next) setView(next)
          }}
          aria-label="报错视图切换"
        >
          <ToggleButton value="trace">分层视图</ToggleButton>
          <ToggleButton value="raw">原文</ToggleButton>
        </ToggleButtonGroup>
      </DialogTitle>
      <ScrollableDialogContent spacing={0}>
        {view === 'trace' ? (
          <ErrorTraceTree error={error} />
        ) : (
          <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
            {rawText}
          </Box>
        )}
      </ScrollableDialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="outlined" onClick={onClose}>
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  )
}
