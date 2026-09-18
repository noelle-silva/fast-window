import * as React from 'react'
import { Box, Button, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import CloseIcon from '@mui/icons-material/Close'
import { planAssistantMessageBlocks, type AssistantMessageBlock } from '../../render/assistantMessagePlan'
import { renderAssistantToolInvocationHtml, renderAssistantToolResultHtml } from '../../render/assistantToolHtml'
import { AssistantMessageHost } from '../../render/assistantMessageHost'
import type { AiChatToastOptions } from '../../gateway/capabilities'
import { readToolConfirmationInfo } from '../../domain/toolConfirmation'
import { AssistantReasoningPanel } from './AssistantReasoningPanel'
import { ToolConfirmationCard } from './ToolConfirmationCard'

type AssistantMessageBlocksProps = {
  controller: any
  mid: string
  isGenerating: boolean
  text: string
  parts: any[]
  renderSafetyPolicyKey: string
  chatRootRef: React.RefObject<HTMLElement | null>
  disabled?: boolean
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
  if (block.kind === 'reasoning') return { bgcolor: 'rgba(245, 158, 11, .045)' }
  if (block.kind === 'tool_invocation' || block.kind === 'tool_result') return { bgcolor: 'rgba(248,250,252,.92)' }
  return { bgcolor: 'rgba(255,255,255,.54)' }
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

function submitKey(decisionId: string, approved: boolean) {
  return `${decisionId}:${approved ? 'approve' : 'deny'}`
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

function renderToolBlockHtml(block: AssistantMessageBlock) {
  if (block.kind === 'tool_invocation') return renderAssistantToolInvocationHtml(block.part)
  if (block.kind === 'tool_result') return renderAssistantToolResultHtml(block.part)
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
  const name = String(first?.part?.toolName || 'tool')
  const state = String(first?.part?.state || '').trim()
  const result = item.blocks.find((block) => block.kind === 'tool_result')?.part?.result
  const status = result && typeof result === 'object' ? String(result.status || '').trim() : ''
  const summary = [state, status].filter(Boolean).join(' · ')

  return (
    <Paper
      key={item.id}
      elevation={0}
      data-mid={mid}
      data-assistant-block-kind="tool_session"
      sx={{
        background: '#fff',
        borderRadius: 3,
        overflow: 'hidden',
        boxShadow: '0 8px 24px rgba(15,23,42,.06)',
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
        <Box sx={{ width: 10, height: 28, borderRadius: 999, background: 'rgba(15,23,42,.18)' }} />
        <Stack spacing={0.15} sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 950, color: 'rgba(15,23,42,.92)' }} noWrap>
            {name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(15,23,42,.62)' }} noWrap>
            {summary || '工具调用'}
          </Typography>
        </Stack>
        <Box sx={{ flex: 1, minWidth: 8 }} />
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </Stack>
      <Collapse in={expanded} timeout={180} unmountOnExit>
        <Stack spacing={0.75} sx={{ px: 1, pb: 1 }}>
          {item.blocks.map((block) => {
            const isEditing = editing.id === block.id
            const tone = blockTone(block)
            const canEdit = !disabled
            const canDelete = !disabled
            return (
              <Paper
                key={block.id}
                elevation={0}
                data-mid={mid}
                data-assistant-block-kind={block.kind}
                sx={{ bgcolor: tone.bgcolor, borderRadius: 2.5, px: 1.1, py: 0.9, overflow: 'hidden' }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.65, minWidth: 0 }}>
                  <Typography variant="caption" sx={{ fontWeight: 900, color: 'rgba(15,23,42,.68)', minWidth: 0 }} noWrap>
                    {blockTitle(block)}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 8 }} />
                  {isEditing ? (
                    <>
                      <Tooltip title="保存"><span><IconButton size="small" aria-label="保存消息块" disabled={!!disabled} onClick={() => onSaveEdit(block)}><SaveOutlinedIcon fontSize="inherit" /></IconButton></span></Tooltip>
                      <Tooltip title="取消"><IconButton size="small" aria-label="取消编辑消息块" onClick={() => onSetEditing({ id: '', text: '' })}><CloseIcon fontSize="inherit" /></IconButton></Tooltip>
                    </>
                  ) : (
                    <>
                      <Tooltip title="编辑"><span><IconButton size="small" aria-label="编辑消息块" disabled={!canEdit} onClick={() => onSetEditing({ id: block.id, text: blockEditText(block) })}><EditOutlinedIcon fontSize="inherit" /></IconButton></span></Tooltip>
                      <Tooltip title="复制"><IconButton size="small" aria-label="复制消息块" onClick={() => writeClipboard(controller, blockCopyText(block))}><ContentCopyIcon fontSize="inherit" /></IconButton></Tooltip>
                      <Tooltip title="删除"><span><IconButton size="small" aria-label="删除消息块" disabled={!canDelete} onClick={() => onSetDeleting(block)}><DeleteOutlineIcon fontSize="inherit" /></IconButton></span></Tooltip>
                    </>
                  )}
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
                    sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
                  />
                ) : (
                  <Box className="prose" dangerouslySetInnerHTML={{ __html: renderToolBlockHtml(block) }} />
                )}
              </Paper>
            )
          })}
        </Stack>
      </Collapse>
    </Paper>
  )
}

export function AssistantMessageBlocks(props: AssistantMessageBlocksProps) {
  const { controller, mid, isGenerating, text, parts, renderSafetyPolicyKey, chatRootRef, disabled } = props
  const blocks = React.useMemo(() => planAssistantMessageBlocks(text, parts), [text, parts])
  const displayItems = React.useMemo(() => buildDisplayItems(blocks), [blocks])
  const [editing, setEditing] = React.useState<EditingBlock>({ id: '', text: '' })
  const [deleting, setDeleting] = React.useState<AssistantMessageBlock | null>(null)
  const [expandedToolSessions, setExpandedToolSessions] = React.useState<Set<string>>(() => new Set())
  const [submittingConfirmation, setSubmittingConfirmation] = React.useState('')

  React.useEffect(() => {
    setEditing({ id: '', text: '' })
    setDeleting(null)
    setExpandedToolSessions(() => new Set())
    setSubmittingConfirmation('')
  }, [mid, text, parts])

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

  const submitToolConfirmationDecision = async (info: NonNullable<ReturnType<typeof readToolConfirmationInfo>>, approved: boolean) => {
    const action = controller?.actions?.submitToolConfirmation
    if (typeof action !== 'function') {
      showToast(controller, '当前客户端未接入工具确认提交', { kind: 'error' })
      return
    }
    const key = submitKey(info.decisionId, approved)
    setSubmittingConfirmation(key)
    try {
      await Promise.resolve(action({ messageId: mid, decisionId: info.decisionId, approved }))
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
              <AssistantMessageHost controller={controller} className="prose" text={block.text} mid={mid} renderSafetyPolicyKey={renderSafetyPolicyKey} chatRootRef={chatRootRef} />
            </Box>
          )
        }
        if (block.kind === 'reasoning') {
          return <AssistantReasoningPanel key={block.id} controller={controller} mid={mid} isGenerating={isGenerating} text={String(block.part?.text || '')} renderSafetyPolicyKey={renderSafetyPolicyKey} chatRootRef={chatRootRef} />
        }
        if (block.kind === 'tool_confirmation') {
          const info = readToolConfirmationInfo(block.part)
          if (!info) return null
          const approveKey = submitKey(info.decisionId, true)
          const rejectKey = submitKey(info.decisionId, false)
          return (
            <ToolConfirmationCard
              key={block.id}
              info={info}
              submitting={submittingConfirmation === approveKey || submittingConfirmation === rejectKey}
              onDecision={(approved) => submitToolConfirmationDecision(info, approved)}
            />
          )
        }
        const isEditing = editing.id === block.id
        const tone = blockTone(block)
        const canEdit = !disabled
        const canDelete = !disabled
        return (
          <Paper
            key={block.id}
            elevation={0}
            data-mid={mid}
            data-assistant-block-kind={block.kind}
            sx={{
              bgcolor: tone.bgcolor,
              borderRadius: 3,
              px: 1.1,
              py: 0.9,
              overflow: 'hidden',
            }}
          >
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.65, minWidth: 0 }}>
              <Typography variant="caption" sx={{ fontWeight: 900, color: 'rgba(15,23,42,.68)', minWidth: 0 }} noWrap>
                {blockTitle(block)}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 8 }} />
              {isEditing ? (
                <>
                  <Tooltip title="保存">
                    <span>
                      <IconButton size="small" aria-label="保存消息块" disabled={!!disabled} onClick={() => saveEdit(block)}>
                        <SaveOutlinedIcon fontSize="inherit" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="取消">
                    <IconButton size="small" aria-label="取消编辑消息块" onClick={() => setEditing({ id: '', text: '' })}>
                      <CloseIcon fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                </>
              ) : (
                <>
                  <Tooltip title="编辑">
                    <span>
                      <IconButton size="small" aria-label="编辑消息块" disabled={!canEdit} onClick={() => setEditing({ id: block.id, text: blockEditText(block) })}>
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
                      <IconButton size="small" aria-label="删除消息块" disabled={!canDelete} onClick={() => setDeleting(block)}>
                        <DeleteOutlineIcon fontSize="inherit" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </>
              )}
            </Stack>

            {isEditing ? (
              <TextField
                autoFocus
                fullWidth
                multiline
                minRows={5}
                size="small"
                value={editing.text}
                onChange={(event) => setEditing((current) => ({ ...current, text: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setEditing({ id: '', text: '' })
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveEdit(block)
                }}
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
              />
            ) : (
              <Box className="prose" dangerouslySetInnerHTML={{ __html: renderToolBlockHtml(block) }} />
            )}
          </Paper>
        )
      })}

      <Dialog open={!!deleting} onClose={() => setDeleting(null)} fullWidth maxWidth="xs">
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
      </Dialog>
    </Stack>
  )
}
