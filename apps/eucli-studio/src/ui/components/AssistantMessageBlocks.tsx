import * as React from 'react'
import { Box, Button, Collapse, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { DependableDialog } from './DependableOverlay'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import CloseIcon from '@mui/icons-material/Close'
import { planAssistantMessageBlocks, type AssistantMessageBlock } from '../../render/assistantMessagePlan'
import { renderAssistantToolInvocationBodyHtml, renderAssistantToolResultBodyHtml, toolBlockCallId } from '../../render/assistantToolHtml'
import { AssistantMessageHost } from '../../render/assistantMessageHost'
import type { AiChatToastOptions } from '../../gateway/capabilities'
import { readToolConfirmationInfo } from '../../domain/toolConfirmation'
import { normalizeDurationMs } from '../../domain/messageTiming'
import { toolCallPhase } from '../../domain/toolCallState'
import { toolLiveElapsedMs, toolRunAnchorMs } from '../../domain/toolRunTiming'
import type { ReasoningDisplayMode } from '../../domain/reasoningDisplay'
import { AssistantReasoningPanel } from './AssistantReasoningPanel'
import { ToolCallStatusDot } from './ToolCallStatusDot'
import { ToolConfirmationCard, type ToolConfirmationDecision } from './ToolConfirmationCard'
import { formatDurationMs } from '../utils/time'
import { useLiveNowMs } from '../hooks/useLiveNowMs'

type AssistantMessageBlocksProps = {
  controller: any
  mid: string
  isGenerating: boolean
  text: string
  parts: any[]
  reasoningDisplayMode: ReasoningDisplayMode
  reasoningRenderEnabled: boolean
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
  disabled?: boolean
  // 消息级缓存代际：同一会话共享一代，切会话即整代降级。
  cacheScope?: string
}

type EditingBlock = { id: string; text: string }
type ToolDetailBlock = Extract<AssistantMessageBlock, { kind: 'tool_invocation' | 'tool_result' }>
type DisplayItem = { kind: 'block'; block: AssistantMessageBlock } | { kind: 'tool_session'; id: string; blocks: ToolDetailBlock[] }

function blockTitle(block: AssistantMessageBlock) {
  if (block.kind === 'text') return '消息正文'
  if (block.kind === 'reasoning') return '思考过程'
  if (block.kind === 'tool_confirmation') return '工具确认'
  if (block.kind === 'tool_invocation') return '工具调用'
  return '工具返回'
}

function blockTone(block: AssistantMessageBlock) {
  if (block.kind === 'reasoning') return { bgcolor: 'var(--studio-warning-bg)' }
  if (block.kind === 'tool_invocation' || block.kind === 'tool_result') return { bgcolor: 'var(--studio-field)' }
  return { bgcolor: 'var(--studio-paper)' }
}

function isToolDetailBlock(block: AssistantMessageBlock | undefined): block is ToolDetailBlock {
  return !!block && (block.kind === 'tool_invocation' || block.kind === 'tool_result')
}

function partIdentity(part: any) {
  return String(part?.id || part?.callId || '').trim()
}

function toolSessionIdentity(block: ToolDetailBlock, index: number) {
  const partId = partIdentity(block.part)
  if (partId) return partId
  const blockId = String(block.id || '').trim()
  const sessionId = blockId.replace(/^tool-(?:invocation|result):/, '')
  return sessionId && sessionId !== blockId ? sessionId : `tool-session:${index}`
}

function buildDisplayItems(blocks: AssistantMessageBlock[]): DisplayItem[] {
  const items: DisplayItem[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!isToolDetailBlock(block)) {
      items.push({ kind: 'block', block })
      continue
    }

    const id = toolSessionIdentity(block, i)
    const grouped: ToolDetailBlock[] = [block]
    const next = blocks[i + 1]
    if (isToolDetailBlock(next) && toolSessionIdentity(next, i + 1) === id && next.kind !== block.kind) {
      grouped.push(next)
      i += 1
    }
    items.push({ kind: 'tool_session', id: `tool-session:${id}`, blocks: grouped })
  }
  return items
}

function blockMutationRef(block: AssistantMessageBlock) {
  const ref: any = { kind: block.kind, blockId: block.id }
  if (block.kind === 'text') {
    ref.start = block.start
    ref.end = block.end
    return ref
  }
  if (block.kind === 'tool_invocation' || block.kind === 'tool_result') {
    ref.partId = partIdentity(block.part)
    if (typeof block.start === 'number') ref.start = block.start
    if (typeof block.end === 'number') ref.end = block.end
  }
  return ref
}

function prettyJson(value: any) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch (_) {
    return String(value ?? '')
  }
}

function invocationEditText(part: any) {
  return prettyJson(part?.input && typeof part.input === 'object' ? part.input : {})
}

function submitKey(decisionId: string, decision: ToolConfirmationDecision) {
  return `${decisionId}:${decision}`
}

function blockEditText(block: AssistantMessageBlock) {
  if (block.kind === 'text') return block.text
  if (block.kind === 'reasoning') return String(block.part?.text || '')
  if (block.kind === 'tool_invocation') return invocationEditText(block.part)
  if (block.kind === 'tool_result') {
    const result = block.part?.result && typeof block.part.result === 'object' ? block.part.result : null
    return String(result?.content || result?.error || '')
  }
  return ''
}

function blockCopyText(block: AssistantMessageBlock) {
  if (block.kind === 'text') return block.text
  if (block.kind === 'reasoning') return String(block.part?.text || '')
  if (block.kind === 'tool_confirmation') return ''
  if (block.kind === 'tool_invocation') return invocationEditText(block.part)
  if (block.kind === 'tool_result') {
    const result = block.part?.result && typeof block.part.result === 'object' ? block.part.result : null
    if (!result) return ''
    const text = String(result.content || result.error || '')
    return text || prettyJson(result)
  }
  return ''
}

function renderToolBlockBodyHtml(block: AssistantMessageBlock) {
  if (block.kind === 'tool_invocation') return renderAssistantToolInvocationBodyHtml(block.part)
  if (block.kind === 'tool_result') return renderAssistantToolResultBodyHtml(block.part)
  return ''
}

function showToast(controller: any, message: string, options?: AiChatToastOptions) {
  controller?.capabilities?.ui?.showToast?.(message, options)
}

function writeClipboard(controller: any, text: string) {
  const writeText = controller?.capabilities?.clipboard?.writeText
  if (typeof writeText !== 'function') {
    showToast(controller, '未授权：clipboard.writeText', { kind: 'error' })
    return
  }
  Promise.resolve()
    .then(() => writeText(text))
    .then(() => showToast(controller, '已复制', { kind: 'success' }))
    .catch(() => showToast(controller, '复制失败', { kind: 'error' }))
}

// ToolDurationText 是工具耗时读数：结果已落地时定格为内核测得的最终耗时，
// 工具运行中则跟随节拍持续推进（含十分位）；每次节拍只重渲染这个读数节点。
function ToolDurationText(props: { part: any }) {
  const { part } = props
  const result = part?.result && typeof part.result === 'object' ? part.result : null
  const runAnchorMs = toolRunAnchorMs(part)
  const liveNowMs = useLiveNowMs(runAnchorMs > 0)
  const durationText = formatDurationMs(result ? result.durationMs : toolLiveElapsedMs(part, liveNowMs))
  if (!durationText) return null
  return (
    <Typography variant="caption" sx={{ color: 'var(--studio-text-secondary)', fontVariantNumeric: 'tabular-nums' }} noWrap>
      {durationText}
    </Typography>
  )
}

function ToolSessionCard(props: {
  controller: any
  disabled?: boolean
  editing: EditingBlock
  item: Extract<DisplayItem, { kind: 'tool_session' }>
  mid: string
  expanded: boolean
  onToggle: (sessionId: string) => void
  onSetDeleting: (block: AssistantMessageBlock | null) => void
  onSetEditing: React.Dispatch<React.SetStateAction<EditingBlock>>
  onSaveEdit: (block: AssistantMessageBlock) => void | Promise<void>
}) {
  const { controller, disabled, editing, item, mid, expanded, onToggle, onSetDeleting, onSetEditing, onSaveEdit } = props
  const first = item.blocks[0]
  const part = first?.part
  const name = String(part?.toolName || 'tool')
  const state = String(part?.state || '').trim()
  const result = item.blocks.find((block) => block.kind === 'tool_result')?.part?.result
  const status = result && typeof result === 'object' ? String(result.status || '').trim() : ''
  const summary = [state, status].filter(Boolean).join(' · ')
  const description = String(part?.input?.description || '').trim()

  return (
    <Paper
      key={item.id}
      elevation={0}
      data-mid={mid}
      data-assistant-block-kind="tool_session"
      sx={{
        background: 'var(--studio-paper)',
        borderRadius: 3,
        overflow: 'hidden',
        boxShadow: 'var(--studio-shadow-soft)',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        role="button"
        tabIndex={0}
        aria-label={expanded ? '收起工具会话' : '展开工具会话'}
        aria-expanded={expanded}
        onClick={() => onToggle(item.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle(item.id)
          }
        }}
        sx={{ px: 1.25, py: 1, cursor: 'pointer', userSelect: 'none', minWidth: 0 }}
      >
        <ToolCallStatusDot part={part} />
        <Stack spacing={0.15} sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 950, color: 'var(--studio-text-primary)' }} noWrap>
            {name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'var(--studio-text-secondary)' }} noWrap>
            {summary || '工具调用'}
          </Typography>
        </Stack>
        {description ? (
          <Typography
            variant="caption"
            title={description}
            sx={{
              color: 'var(--studio-text-secondary)',
              opacity: 0.85,
              alignSelf: 'flex-start',
              minWidth: 0,
              maxWidth: '45%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            noWrap
          >
            {description}
          </Typography>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 8 }} />
        <ToolDurationText part={part} />
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </Stack>
      <Collapse in={expanded} timeout={180} unmountOnExit>
        <Stack spacing={0.75} sx={{ px: 1, pb: 1 }}>
          {item.blocks.map((block) => (
            <ToolBlockCard
              key={block.id}
              controller={controller}
              block={block}
              mid={mid}
              editing={editing}
              disabled={disabled}
              onSetEditing={onSetEditing}
              onSetDeleting={onSetDeleting}
              onSaveEdit={onSaveEdit}
            />
          ))}
        </Stack>
      </Collapse>
    </Paper>
  )
}

// 工具块状态文字：与左侧圆点同源（toolCallPhase），块标题右侧只留一句结论。
const TOOL_PHASE_TEXT: Record<string, string> = {
  success: '成功',
  error: '失败',
  pending: '等待确认',
  running: '运行中',
}
const TOOL_PHASE_COLOR: Record<string, string> = {
  success: 'var(--studio-success-text)',
  error: 'var(--studio-danger-text)',
  pending: 'var(--studio-warning-text)',
  running: 'var(--studio-text-secondary)',
}

// 工具子块：标题、状态、工具名 / callid 与块操作同处块内头部，正文只渲染工具数据。
function ToolBlockCard(props: {
  controller: any
  block: ToolDetailBlock
  mid: string
  editing: EditingBlock
  disabled?: boolean
  onSetEditing: React.Dispatch<React.SetStateAction<EditingBlock>>
  onSetDeleting: (block: AssistantMessageBlock | null) => void
  onSaveEdit: (block: AssistantMessageBlock) => void | Promise<void>
}) {
  const { controller, block, mid, editing, disabled, onSetEditing, onSetDeleting, onSaveEdit } = props
  const isEditing = editing.id === block.id
  const tone = blockTone(block)
  const canEdit = !disabled
  const canDelete = !disabled
  const isResult = block.kind === 'tool_result'
  const phase = toolCallPhase(block.part)
  const title = isResult ? '工具返回结果' : '工具调用'
  const callId = toolBlockCallId(block.part, isResult ? 'result' : 'invocation')
  const toolName = String(block.part?.toolName || block.part?.result?.toolName || 'tool')

  return (
    <Paper
      elevation={0}
      data-mid={mid}
      data-assistant-block-kind={block.kind}
      data-stop="1"
      sx={{
        bgcolor: tone.bgcolor,
        borderRadius: 3,
        px: 1.1,
        py: 0.9,
        overflow: 'hidden',
      }}
    >
      <Box className="fw-tool-header" sx={{ minWidth: 0 }}>
        <Box className="fw-tool-title">
          <Box component="span">{title}</Box>
          <Box component="span" sx={{ fontSize: 12, fontWeight: 800, color: TOOL_PHASE_COLOR[phase] }}>
            {TOOL_PHASE_TEXT[phase]}
          </Box>
        </Box>
        <Box className="fw-tool-spacer" />
        <Stack direction="row" spacing={0.25} alignItems="center">
          {isEditing ? (
            <>
              <Tooltip title="保存">
                <span>
                  <IconButton size="small" aria-label="保存消息块" disabled={!!disabled} onClick={() => onSaveEdit(block)}>
                    <SaveOutlinedIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="取消">
                <IconButton size="small" aria-label="取消编辑消息块" onClick={() => onSetEditing({ id: '', text: '' })}>
                  <CloseIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip title="编辑">
                <span>
                  <IconButton size="small" aria-label="编辑消息块" disabled={!canEdit} onClick={() => onSetEditing({ id: block.id, text: blockEditText(block) })}>
                    <EditOutlinedIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="复制">
                <IconButton size="small" aria-label="复制消息块" onClick={() => writeClipboard(controller, blockCopyText(block))}>
                  <ContentCopyIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除">
                <span>
                  <IconButton size="small" aria-label="删除消息块" disabled={!canDelete} onClick={() => onSetDeleting(block)}>
                    <DeleteOutlineIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
        </Stack>
      </Box>

      <Stack direction="row" spacing={0.75} alignItems="center" data-tool-meta sx={{ mb: 0.75, minWidth: 0 }}>
        <Box component="span" className="fw-tool-chip">
          {toolName}
        </Box>
        {callId ? (
          <Box component="code" className="fw-tool-call-id">
            {callId}
          </Box>
        ) : null}
      </Stack>

      {isEditing ? (
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={5}
          size="small"
          value={editing.text}
          onChange={(event) => onSetEditing((current) => ({ ...current, text: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onSetEditing({ id: '', text: '' })
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) onSaveEdit(block)
          }}
          sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'var(--studio-paper)' } }}
        />
      ) : (
        <Box className="prose" dangerouslySetInnerHTML={{ __html: renderToolBlockBodyHtml(block) }} />
      )}
    </Paper>
  )
}

export function AssistantMessageBlocks(props: AssistantMessageBlocksProps) {
  const { controller, mid, isGenerating, text, parts, reasoningDisplayMode, reasoningRenderEnabled, renderSafetyPolicyKey, chatRootRef, disabled, cacheScope } = props
  const blocks = React.useMemo(() => planAssistantMessageBlocks(text, parts), [text, parts])
  const displayItems = React.useMemo(() => buildDisplayItems(blocks), [blocks])
  // 最后一枚部分就是当前仍在输出的那一段；正文一旦出现，前面的思考都已输出完成。
  const lastPart = React.useMemo(() => (parts.length ? parts[parts.length - 1] : null), [parts])
  const answerStarted = !!String(text || '').trim()
  const [editing, setEditing] = React.useState<EditingBlock>({ id: '', text: '' })
  const [deleting, setDeleting] = React.useState<AssistantMessageBlock | null>(null)
  const [expandedToolSessions, setExpandedToolSessions] = React.useState<Set<string>>(() => new Set())
  const [submittingConfirmation, setSubmittingConfirmation] = React.useState('')

  // 只随消息身份重置编辑态：流式推进时正文/片段每字都在变，
  // 若跟着它们重置状态，等于每个字白多渲染一遍，拖慢主线程。
  React.useEffect(() => {
    setEditing({ id: '', text: '' })
    setDeleting(null)
    setExpandedToolSessions(() => new Set())
    setSubmittingConfirmation('')
  }, [mid])

  const toggleToolSession = (sessionId: string) => {
    setExpandedToolSessions((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const saveEdit = async (block: AssistantMessageBlock) => {
    if (!editing.id || editing.id !== block.id) return
    const ok = await Promise.resolve(controller.actions.editMessageBlock?.(mid, blockMutationRef(block), editing.text))
    if (ok === true) setEditing({ id: '', text: '' })
  }

  const deleteBlock = async () => {
    const block = deleting
    if (!block) return
    const ok = await Promise.resolve(controller.actions.deleteMessageBlock?.(mid, blockMutationRef(block)))
    if (ok === true) setDeleting(null)
  }

  const submitToolConfirmationDecision = async (info: NonNullable<ReturnType<typeof readToolConfirmationInfo>>, decision: ToolConfirmationDecision) => {
    const action = controller?.actions?.submitToolConfirmation
    if (typeof action !== 'function') {
      showToast(controller, '当前客户端未接入工具确认提交', { kind: 'error' })
      return
    }
    const key = submitKey(info.decisionId, decision)
    setSubmittingConfirmation(key)
    try {
      await Promise.resolve(action({ messageId: mid, decisionId: info.decisionId, decision }))
    } finally {
      setSubmittingConfirmation((current) => (current === key ? '' : current))
    }
  }

  if (!blocks.length) return null

  return (
    <Stack spacing={0.9} data-mid={mid}>
      {displayItems.map((item) => {
        if (item.kind === 'tool_session') {
          return (
            <ToolSessionCard
              key={item.id}
              controller={controller}
              disabled={disabled}
              editing={editing}
              expanded={expandedToolSessions.has(item.id)}
              item={item}
              mid={mid}
              onSaveEdit={saveEdit}
              onSetDeleting={setDeleting}
              onSetEditing={setEditing}
              onToggle={toggleToolSession}
            />
          )
        }

        const block = item.block
        if (block.kind === 'text') {
          return (
            <Box key={block.id} data-mid={mid} data-assistant-block-kind={block.kind} sx={{ minWidth: 0 }}>
              <AssistantMessageHost controller={controller} className="prose" text={block.text} mid={mid} renderSafetyPolicyKey={renderSafetyPolicyKey} chatRootRef={chatRootRef} streaming={isGenerating} cacheScope={cacheScope} />
            </Box>
          )
        }
        if (block.kind === 'reasoning') {
          const reasoningActive = isGenerating && block.part === lastPart && !answerStarted
          return (
            <AssistantReasoningPanel
              key={block.id}
              controller={controller}
              mid={mid}
              isActive={reasoningActive}
              displayMode={reasoningDisplayMode}
              renderMarkdown={reasoningRenderEnabled}
              text={String(block.part?.text || '')}
              durationMs={normalizeDurationMs(block.part?.durationMs)}
              renderSafetyPolicyKey={renderSafetyPolicyKey}
              chatRootRef={chatRootRef}
            />
          )
        }
        if (block.kind === 'tool_confirmation') {
          const info = readToolConfirmationInfo(block.part)
          if (!info) return null
          const rejectKey = submitKey(info.decisionId, 'reject')
          const onceKey = submitKey(info.decisionId, 'once')
          const sessionKey = submitKey(info.decisionId, 'session')
          return (
            <ToolConfirmationCard
              key={block.id}
              info={info}
              submitting={submittingConfirmation === rejectKey || submittingConfirmation === onceKey || submittingConfirmation === sessionKey}
              onDecision={(decision) => submitToolConfirmationDecision(info, decision)}
            />
          )
        }
        if (!isToolDetailBlock(block)) return null
        return (
          <ToolBlockCard
            key={block.id}
            controller={controller}
            block={block}
            mid={mid}
            editing={editing}
            disabled={disabled}
            onSetEditing={setEditing}
            onSetDeleting={setDeleting}
            onSaveEdit={saveEdit}
          />
        )
      })}

      <DependableDialog open={!!deleting} onClose={() => setDeleting(null)} fullWidth maxWidth="xs">
        <DialogTitle>删除这个消息块？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            只删除当前的{deleting ? blockTitle(deleting) : '消息块'}；同一条回复里的其他块会保留。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>取消</Button>
          <Button color="error" variant="contained" disabled={!!disabled || !deleting} onClick={deleteBlock}>删除</Button>
        </DialogActions>
      </DependableDialog>
    </Stack>
  )
}
