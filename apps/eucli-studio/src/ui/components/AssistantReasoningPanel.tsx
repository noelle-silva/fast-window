import * as React from 'react'
import { Box, Collapse, Paper, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { AssistantMessageHost } from '../../render/assistantMessageHost'
import { CustomScrollArea } from './CustomScrollArea'
import { formatDurationMs } from '../utils/time'

const REASONING_MAX_HEIGHT_PX = 320
const FOLLOW_BOTTOM_THRESHOLD_PX = 24
// 开合过渡：展开减速缓入、收起稍快，观感自然。
const COLLAPSE_TIMEOUT = { enter: 240, exit: 180 }
const COLLAPSE_EASING = { enter: 'cubic-bezier(0.22, 1, 0.36, 1)', exit: 'cubic-bezier(0.4, 0, 1, 1)' }
const CHEVRON_TRANSITION = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)'

type AssistantReasoningPanelProps = {
  controller: any
  mid: string
  isActive: boolean
  displayMode: ReasoningDisplayMode
  text: string
  durationMs: number
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
}

export function AssistantReasoningPanel(props: AssistantReasoningPanelProps) {
  const { controller, mid, isActive, displayMode, text, durationMs, renderSafetyPolicyKey, chatRootRef } = props
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
    // 展开瞬间：思考仍在输出就回到最新一行并恢复跟随；已结束则保持原有阅读位置。
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
        borderColor: 'rgba(15, 23, 42, .10)',
        bgcolor: '#fff',
        boxShadow: '0 8px 22px rgba(15,23,42,.05)',
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
        <Typography variant="caption" sx={{ fontWeight: 900, color: 'rgba(15, 23, 42, .72)', letterSpacing: '.04em' }}>
          思考过程
        </Typography>
        <Box sx={{ flex: 1 }} />
        {durationText ? (
          <Typography variant="caption" sx={{ color: 'rgba(15, 23, 42, .5)', fontVariantNumeric: 'tabular-nums' }}>
            {durationText}
          </Typography>
        ) : null}
        <ExpandMoreIcon
          fontSize="inherit"
          sx={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: CHEVRON_TRANSITION }}
        />
      </Stack>
      <Collapse in={expanded} timeout={COLLAPSE_TIMEOUT} easing={COLLAPSE_EASING} mountOnEnter>
        <Box sx={{ px: 1.1, pb: 1.05, pt: 0.1 }}>
          <CustomScrollArea
            ref={scrollRef}
            axis="y"
            hostSx={{ maxHeight: REASONING_MAX_HEIGHT_PX }}
            scrollSx={{ maxHeight: REASONING_MAX_HEIGHT_PX, pr: 1.25 }}
          >
            <AssistantMessageHost controller={controller} className="prose" text={text} mid={`${mid}:reasoning`} renderSafetyPolicyKey={renderSafetyPolicyKey} chatRootRef={chatRootRef} />
          </CustomScrollArea>
        </Box>
      </Collapse>
    </Paper>
  )
}
