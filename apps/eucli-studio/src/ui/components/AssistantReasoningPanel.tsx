import * as React from 'react'
import { Box, Collapse, IconButton, Paper, Stack, Typography } from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { AssistantMessageHost } from '../../render/assistantMessageHost'

type AssistantReasoningPanelProps = {
  controller: any
  mid: string
  isGenerating: boolean
  text: string
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
}

export function AssistantReasoningPanel(props: AssistantReasoningPanelProps) {
  const { controller, mid, isGenerating, text, renderSafetyPolicyKey, chatRootRef } = props
  const [expanded, setExpanded] = React.useState(() => isGenerating)

  React.useEffect(() => {
    setExpanded(isGenerating)
  }, [isGenerating, text])

  if (!String(text || '').trim()) return null

  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 1,
        borderRadius: 3,
        borderColor: 'rgba(15, 23, 42, .10)',
        bgcolor: '#fff',
        boxShadow: '0 8px 22px rgba(15,23,42,.05)',
        overflow: 'hidden',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1.1, py: 0.85 }}>
        <Typography variant="caption" sx={{ fontWeight: 900, color: 'rgba(15, 23, 42, .72)', letterSpacing: '.04em' }}>
          思考过程
        </Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton
          size="small"
          aria-label={expanded ? '收起思考过程' : '展开思考过程'}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ExpandLessIcon fontSize="inherit" /> : <ExpandMoreIcon fontSize="inherit" />}
        </IconButton>
      </Stack>
      <Collapse in={expanded} timeout={160} unmountOnExit>
        <Box sx={{ px: 1.1, pb: 1.05, pt: 0.1 }}>
          <AssistantMessageHost controller={controller} className="prose" text={text} mid={`${mid}:reasoning`} renderSafetyPolicyKey={renderSafetyPolicyKey} chatRootRef={chatRootRef} />
        </Box>
      </Collapse>
    </Paper>
  )
}
