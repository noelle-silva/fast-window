import * as React from 'react'
import { Box, Button, Stack, Typography } from '@mui/material'
import { colorMixVar } from '../colorThemeStyles'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { formatJsonText } from './requestRecordFormat'
import type { RequestPayloadMessage, RequestPayloadTool, RequestPayloadView, ResponseSegment, ResponseStreamView } from './requestRecordParse'
import type { RequestRecordViewOptions } from '../../domain/requestRecordViewOptions'

export const RECORD_TEXT_CHUNK = 200_000

type RoleStyle = {
  label: string
  background: string
  badgeBackground: string
  badgeColor: string
}

const ROLE_STYLES: Record<string, RoleStyle> = {
  system: {
    label: '系统',
    background: 'var(--studio-paper-muted)',
    badgeBackground: colorMixVar('--studio-text-secondary', 12),
    badgeColor: 'var(--studio-text-secondary)',
  },
  user: {
    label: '用户',
    background: colorMixVar('--studio-primary', 10),
    badgeBackground: colorMixVar('--studio-primary', 16),
    badgeColor: 'var(--studio-primary)',
  },
  assistant: {
    label: '助手',
    background: colorMixVar('--studio-secondary', 12),
    badgeBackground: colorMixVar('--studio-secondary', 18),
    badgeColor: 'var(--studio-secondary)',
  },
  tool: {
    label: '工具',
    background: colorMixVar('--studio-warning', 14),
    badgeBackground: colorMixVar('--studio-warning', 22),
    badgeColor: 'var(--studio-warning)',
  },
}

const FALLBACK_ROLE_STYLE: RoleStyle = {
  label: '其他',
  background: 'var(--studio-paper-muted)',
  badgeBackground: colorMixVar('--studio-text-secondary', 12),
  badgeColor: 'var(--studio-text-secondary)',
}

function roleStyle(role: string): RoleStyle {
  return ROLE_STYLES[role] || { ...FALLBACK_ROLE_STYLE, label: role || FALLBACK_ROLE_STYLE.label }
}

// RecordTextView 渐进文本视图：初始渲染一块，滚动到底部继续加载下一块；滚动条使用项目自绘样式。
export function RecordTextView({ text, boxed = true }: { text: string; boxed?: boolean }) {
  const full = String(text ?? '')
  const [visibleLength, setVisibleLength] = React.useState(RECORD_TEXT_CHUNK)
  React.useEffect(() => {
    setVisibleLength(RECORD_TEXT_CHUNK)
  }, [full])
  const visible = visibleLength < full.length ? full.slice(0, visibleLength) : full
  const hasMore = visible.length < full.length
  return (
    <CustomScrollArea
      hostSx={{
        maxHeight: 320,
        ...(boxed ? { borderRadius: 1.5, bgcolor: 'var(--studio-paper-muted)', overflow: 'hidden' } : {}),
      }}
      scrollSx={{ maxHeight: 320, ...(boxed ? { p: 1.5 } : {}) }}
      onScrollPositionChange={(element) => {
        if (!hasMore) return
        if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) {
          setVisibleLength((current) => current + RECORD_TEXT_CHUNK)
        }
      }}
    >
      <Box
        component="pre"
        sx={{
          m: 0,
          fontSize: 12,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}
      >
        {full ? visible : '（空）'}
        {hasMore ? '\n\n…（滚动到底部继续加载）' : ''}
      </Box>
    </CustomScrollArea>
  )
}

function CollapsibleBlock({ label, badgeColor, background, defaultOpen = false, children }: { label: string; badgeColor: string; background?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen)
  React.useEffect(() => {
    setOpen(defaultOpen)
  }, [defaultOpen])
  return (
    <Box sx={{ borderRadius: 1.5, bgcolor: background, p: 0.75 }}>
      <Button
        size="small"
        variant="text"
        onClick={() => setOpen((current) => !current)}
        sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: 12, fontWeight: 900, textTransform: 'none', color: badgeColor }}
      >
        {open ? `${label}（点击收起）` : `${label}（点击展开）`}
      </Button>
      {open ? <Box sx={{ mt: 0.25 }}>{children}</Box> : null}
    </Box>
  )
}

export function KeyValueView({ entries }: { entries: Array<{ key: string; value: string }> }) {
  return (
    <Box sx={{ borderRadius: 1.5, bgcolor: 'var(--studio-paper-muted)', p: 1 }}>
      <Stack spacing={0.25}>
        {entries.map((entry, index) => (
          <Box key={`${entry.key}-${index}`} sx={{ display: 'flex', gap: 1, alignItems: 'baseline', fontFamily: 'monospace', fontSize: 12 }}>
            <Box component="span" sx={{ fontWeight: 800, flexShrink: 0 }}>{entry.key}:</Box>
            <Box component="span" sx={{ minWidth: 0, overflowWrap: 'break-word', color: 'var(--studio-text-secondary)' }}>{entry.value}</Box>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}

export function RequestPayloadView({ view, viewOptions }: { view: RequestPayloadView; viewOptions: RequestRecordViewOptions }) {
  return (
    <Stack spacing={1.5}>
      {view.params.length ? (
        <Box sx={{ borderRadius: 1.5, bgcolor: 'var(--studio-paper-muted)', p: 1 }}>
          <Stack direction="row" flexWrap="wrap" gap={1.5}>
            {view.params.map((param) => (
              <Box key={param.key} sx={{ display: 'flex', gap: 0.5, fontFamily: 'monospace', fontSize: 12, minWidth: 0 }}>
                <Box component="span" sx={{ color: 'var(--studio-text-secondary)' }}>{param.key}</Box>
                <Box component="span" sx={{ fontWeight: 800, overflowWrap: 'break-word' }}>{param.value}</Box>
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}
      <Stack spacing={1}>
        {view.messages.map((message, index) => (
          <PayloadMessageBlock key={index} message={message} viewOptions={viewOptions} />
        ))}
      </Stack>
      {view.tools.length ? <PayloadToolsBlock tools={view.tools} defaultOpen={viewOptions.requestToolsOpen} /> : null}
    </Stack>
  )
}

function PayloadMessageBlock({ message, viewOptions }: { message: RequestPayloadMessage; viewOptions: RequestRecordViewOptions }) {
  const style = roleStyle(message.role)
  return (
    <Box sx={{ borderRadius: 1.5, bgcolor: style.background, p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <Box component="span" sx={{ fontSize: 11, fontWeight: 900, px: 0.75, py: 0.2, borderRadius: 999, bgcolor: style.badgeBackground, color: style.badgeColor }}>
          {style.label}
        </Box>
        {message.name ? <Typography variant="caption" color="text.secondary">{message.name}</Typography> : null}
        {message.toolCallId ? <Typography variant="caption" color="text.secondary">call {message.toolCallId}</Typography> : null}
      </Box>
      {message.reasoning ? (
        <Box sx={{ mb: 0.5 }}>
          <CollapsibleBlock label="思考" badgeColor="var(--studio-secondary)" background={colorMixVar('--studio-secondary', 10)} defaultOpen={viewOptions.requestReasoningOpen}>
            <RecordTextView text={message.reasoning} boxed={false} />
          </CollapsibleBlock>
        </Box>
      ) : null}
      {message.content ? (
        message.role === 'tool' ? (
          <CollapsibleBlock label="工具返回" badgeColor="var(--studio-warning)" defaultOpen={viewOptions.requestToolResultsOpen}>
            <RecordTextView text={message.content} boxed={false} />
          </CollapsibleBlock>
        ) : (
          <RecordTextView text={message.content} boxed={false} />
        )
      ) : null}
      {message.toolCalls.map((toolCall, index) => (
        <Box key={index} sx={{ mt: 0.75 }}>
          <CollapsibleBlock label={`工具调用 ${toolCall.name || '未命名'}`} badgeColor="var(--studio-warning)" background={colorMixVar('--studio-warning', 16)} defaultOpen={viewOptions.requestToolCallsOpen}>
            <RecordTextView text={formatJsonText(toolCall.arguments) ?? toolCall.arguments} boxed={false} />
          </CollapsibleBlock>
        </Box>
      ))}
      {!message.content && !message.toolCalls.length ? (
        <Typography variant="caption" color="text.secondary">（空）</Typography>
      ) : null}
    </Box>
  )
}

function PayloadToolsBlock({ tools, defaultOpen }: { tools: RequestPayloadTool[]; defaultOpen: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen)
  React.useEffect(() => {
    setOpen(defaultOpen)
  }, [defaultOpen])
  return (
    <Box>
      <Button
        size="small"
        variant="text"
        onClick={() => setOpen((current) => !current)}
        sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: 12, textTransform: 'none' }}
      >
        {open ? '收起工具定义' : `展开工具定义（${tools.length} 个）`}
      </Button>
      {open ? (
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {tools.map((tool, index) => (
            <Box key={`${tool.name}-${index}`} sx={{ borderRadius: 1.5, bgcolor: 'var(--studio-paper-muted)', p: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 900 }}>{tool.name || '未命名工具'}</Typography>
              {tool.description ? (
                <Typography variant="caption" display="block" color="text.secondary">{tool.description}</Typography>
              ) : null}
              {tool.parameters ? <RecordTextView text={tool.parameters} boxed={false} /> : null}
            </Box>
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}

export function ResponseStreamView({ view, viewOptions }: { view: ResponseStreamView; viewOptions: RequestRecordViewOptions }) {
  return (
    <Stack spacing={1}>
      {view.segments.map((segment, index) => (
        <ResponseSegmentBlock key={index} segment={segment} viewOptions={viewOptions} />
      ))}
      {view.done ? <Typography variant="caption" color="text.secondary">流已结束</Typography> : null}
    </Stack>
  )
}

function ResponseSegmentBlock({ segment, viewOptions }: { segment: ResponseSegment; viewOptions: RequestRecordViewOptions }) {
  if (segment.kind === 'reasoning') {
    return (
      <CollapsibleBlock label="思考" badgeColor="var(--studio-secondary)" background={colorMixVar('--studio-secondary', 10)} defaultOpen={viewOptions.responseReasoningOpen}>
        <RecordTextView text={segment.text} boxed={false} />
      </CollapsibleBlock>
    )
  }
  if (segment.kind === 'content') {
    return (
      <SegmentFrame label="正文" background="var(--studio-paper-muted)" badgeColor="var(--studio-text-primary)">
        <RecordTextView text={segment.text} boxed={false} />
      </SegmentFrame>
    )
  }
  if (segment.kind === 'toolCall') {
    return (
      <CollapsibleBlock label={`工具调用 ${segment.name || '未命名'}`} badgeColor="var(--studio-warning)" background={colorMixVar('--studio-warning', 14)} defaultOpen={viewOptions.responseToolCallsOpen}>
        <RecordTextView text={formatJsonText(segment.arguments) ?? segment.arguments} boxed={false} />
      </CollapsibleBlock>
    )
  }
  if (segment.kind === 'finish') {
    return (
      <SegmentFrame label="结束" background="var(--studio-paper-muted)" badgeColor="var(--studio-text-secondary)">
        <Typography variant="caption" color="text.secondary">{segment.text}</Typography>
      </SegmentFrame>
    )
  }
  return (
    <SegmentFrame label="其他事件" background="var(--studio-paper-muted)" badgeColor="var(--studio-text-secondary)">
      <RecordTextView text={segment.text} boxed={false} />
    </SegmentFrame>
  )
}

function SegmentFrame({ label, background, badgeColor, children }: { label: string; background: string; badgeColor: string; children: React.ReactNode }) {
  return (
    <Box sx={{ borderRadius: 1.5, bgcolor: background, p: 1 }}>
      <Box component="span" sx={{ display: 'inline-block', fontSize: 11, fontWeight: 900, px: 0.75, py: 0.2, mb: 0.5, borderRadius: 999, bgcolor: colorMixVar('--studio-paper-muted', 60), color: badgeColor }}>
        {label}
      </Box>
      {children}
    </Box>
  )
}
