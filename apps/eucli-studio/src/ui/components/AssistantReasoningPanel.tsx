import * as React from 'react'
import { Box, Collapse, IconButton, Paper, Stack, Typography } from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { AssistantMessageHost } from '../../render/assistantMessageHost'

type AssistantReasoningPanelProps = {
  controller: any
  mid: string
  isActive: boolean
  displayMode: ReasoningDisplayMode
  text: string
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
}

export function AssistantReasoningPanel(props: AssistantReasoningPanelProps) {
  const { controller, mid, isActive, displayMode, text, renderSafetyPolicyKey, chatRootRef } = props
  const [expanded, setExpanded] = React.useState(() => isActive && displayMode !== 'never-expand')
  // 用户手动开合后，这一段思考的展开状态只跟用户走，自动行为不再覆盖。
  const [manuallyToggled, setManuallyToggled] = React.useState(false)
  const wasActiveRef = React.useRef(isActive)

  React.useEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = wasActive || isActive
    if (manuallyToggled) return
    if (displayMode === 'never-expand') {
      setExpanded(false)
      return
    }
    if (isActive) {
      setExpanded(true)
      return
    }
    if (displayMode === 'collapse-when-done') setExpanded(false)
    else if (displayMode === 'stay-expanded' && wasActive) setExpanded(true)
  }, [isActive, displayMode, manuallyToggled])

  const toggleExpanded = () => {
    setManuallyToggled(true)
    setExpanded((value) => !value)
  }

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
          onClick={toggleExpanded}
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
