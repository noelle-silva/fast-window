import * as React from 'react'
import { Box, Collapse, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { AssistantMessageHost } from '../../render/assistantMessageHost'
import { CustomScrollArea } from './CustomScrollArea'
import { ReasoningCleanDialog } from './ReasoningCleanDialog'
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
  const [cleanOpen, setCleanOpen] = React.useState(false)
  const [cleaning, setCleaning] = React.useState(false)
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

  // 吸附滚动推迟到下一帧：本帧提交后再写 scrollTop，避免在提交阶段强读 scrollHeight；
  // 多次增量只会保留最后一次调度，一帧最多一次滚动写入。
  const stickFrameRef = React.useRef(0)

  React.useLayoutEffect(() => {
    const justExpanded = expanded && !wasExpandedRef.current
    wasExpandedRef.current = expanded
    const el = scrollRef.current
    if (!el || !expanded) return
    // 展开瞬间：思考仍在输出就回到最新一行并恢复跟随；已结束则从开头阅读。
    if (justExpanded) stickToBottomRef.current = isActive
    if (!stickToBottomRef.current) return
    if (stickFrameRef.current) cancelAnimationFrame(stickFrameRef.current)
    stickFrameRef.current = requestAnimationFrame(() => {
      stickFrameRef.current = 0
      el.scrollTop = el.scrollHeight
    })
    return () => {
      if (stickFrameRef.current) {
        cancelAnimationFrame(stickFrameRef.current)
        stickFrameRef.current = 0
      }
    }
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

  const confirmClean = async (keywordsText: string) => {
    const action = controller?.actions?.cleanMessageReasoning
    if (typeof action !== 'function') return
    setCleaning(true)
    try {
      const ok = await Promise.resolve(action(mid, keywordsText))
      if (ok === true) setCleanOpen(false)
    } finally {
      setCleaning(false)
    }
  }

  const durationText = formatDurationMs(durationMs)

  if (!String(text || '').trim()) return null

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 1,
        borderRadius: 3,
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
        <Box sx={{ px: 1.1, pb: 1.05 }}>
          {/* 清洗入口只在展开态出现：独占内容第一行，收起时整行随之离场。 */}
          <Stack direction="row" justifyContent="flex-end" alignItems="center" sx={{ minHeight: 30 }}>
            <Tooltip title="清洗思维链">
              <IconButton size="small" aria-label="清洗思维链" onClick={() => setCleanOpen(true)}>
                <CleaningServicesIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          </Stack>
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
      <ReasoningCleanDialog open={cleanOpen} busy={cleaning} onClose={() => setCleanOpen(false)} onConfirm={confirmClean} />
    </Paper>
  )
}
