import * as React from 'react'
import { Box, Collapse, Paper, Stack, Typography } from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { AssistantMessageHost } from '../../render/assistantMessageHost'
import { CustomScrollArea } from './CustomScrollArea'
import { formatDurationMs } from '../utils/time'

const REASONING_MAX_HEIGHT_PX = 320
const FOLLOW_BOTTOM_THRESHOLD_PX = 24

type AssistantReasoningPanelProps = {
  controller: any
  mid: string
  isActive: boolean
  displayMode: ReasoningDisplayMode
  // 是否对思考内容做 Markdown 富渲染；关闭时按纯文本展示。
  renderMarkdown: boolean
  text: string
  durationMs: number
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
}

export function AssistantReasoningPanel(props: AssistantReasoningPanelProps) {
  const { controller, mid, isActive, displayMode, renderMarkdown, text, durationMs, renderSafetyPolicyKey, chatRootRef } = props
  const [expanded, setExpanded] = React.useState(() => isActive && displayMode !== 'never-expand')
  // 用户手动开合后，这一段思考的展开状态只跟用户走，自动行为不再覆盖。
  const [manuallyToggled, setManuallyToggled] = React.useState(false)
  const wasActiveRef = React.useRef(isActive)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  // 视窗是否吸附在底部；只认真实滚动事件，输出中内容自然增高不算用户上滚。
  const stickToBottomRef = React.useRef(true)
  const wasExpandedRef = React.useRef(false)

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || !expanded) return
    const onScroll = () => {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_BOTTOM_THRESHOLD_PX
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [expanded])

  React.useLayoutEffect(() => {
    const justExpanded = expanded && !wasExpandedRef.current
    wasExpandedRef.current = expanded
    const el = scrollRef.current
    if (!el || !expanded) return
    // 展开瞬间：思考仍在输出就回到最新一行并恢复跟随；已结束则从开头阅读。
    if (justExpanded) stickToBottomRef.current = isActive
    if (!stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [text, expanded, isActive])

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

  const durationText = formatDurationMs(durationMs)

  if (!String(text || '').trim()) return null

  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 1,
        borderRadius: 3,
        borderColor: 'var(--studio-border)',
        bgcolor: 'var(--studio-paper)',
        boxShadow: 'var(--studio-shadow-soft)',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? '收起思考过程' : '展开思考过程'}
        onClick={toggleExpanded}
        onKeyDown={(e) => {
          const k = String((e as any)?.key || '')
          if (k === 'Enter' || k === ' ') {
            e.preventDefault()
            toggleExpanded()
          }
        }}
        sx={{ px: 1.1, py: 0.85, cursor: 'pointer', userSelect: 'none' }}
      >
        <Typography variant="caption" sx={{ fontWeight: 900, color: 'var(--studio-text-primary)', letterSpacing: '.04em' }}>
          思考过程
        </Typography>
        <Box sx={{ flex: 1 }} />
        {durationText ? (
          <Typography variant="caption" sx={{ color: 'var(--studio-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {durationText}
          </Typography>
        ) : null}
        {expanded ? <ExpandLessIcon fontSize="inherit" /> : <ExpandMoreIcon fontSize="inherit" />}
      </Stack>
      <Collapse in={expanded} timeout={160} unmountOnExit>
        <Box sx={{ px: 1.1, pb: 1.05, pt: 0.1 }}>
          <CustomScrollArea
            ref={scrollRef}
            axis="y"
            hostSx={{ maxHeight: REASONING_MAX_HEIGHT_PX }}
            scrollSx={{ maxHeight: REASONING_MAX_HEIGHT_PX, pr: 1.25 }}
          >
            {renderMarkdown ? (
              <AssistantMessageHost controller={controller} className="prose" text={text} mid={`${mid}:reasoning`} renderSafetyPolicyKey={renderSafetyPolicyKey} chatRootRef={chatRootRef} streaming={isActive} />
            ) : (
              // 纯文本模式：不做 Markdown 解析，直接原样展示思考内容。
              <Typography component="pre" sx={{ m: 0, fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                {text}
              </Typography>
            )}
          </CustomScrollArea>
        </Box>
      </Collapse>
    </Paper>
  )
}
