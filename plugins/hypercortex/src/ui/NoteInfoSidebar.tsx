import { Box, Typography } from '@mui/material'

function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleString()
  }
}

function NoteIdChip(props: {
  noteId: string
  title?: string
  onOpen?: () => void
}) {
  const { noteId, title, onOpen } = props
  const clickable = typeof onOpen === 'function'
  return (
    <Box
      component="span"
      onClick={clickable ? onOpen : undefined}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.25,
        py: 0.5,
        borderRadius: 999,
        fontSize: 12,
        color: clickable ? '#1976d2' : 'rgba(0,0,0,.55)',
        bgcolor: clickable ? 'rgba(25,118,210,.06)' : 'rgba(0,0,0,.04)',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background 120ms',
        '&:hover': clickable ? { bgcolor: 'rgba(25,118,210,.12)' } : {},
      }}
    >
      {title || (noteId ? noteId.slice(0, 12) + (noteId.length > 12 ? '…' : '') : '—')}
    </Box>
  )
}

function NoteRefSection(props: {
  title: string
  ids: string[]
  resolveTitle: (id: string) => string | undefined
  canOpenId: (id: string) => boolean
  onOpenId: (id: string) => void
}) {
  const ids = Array.from(new Set((props.ids || []).map(v => String(v || '').trim()).filter(Boolean)))
  const visibleIds = ids.filter(id => props.canOpenId(id))
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)', mb: 0.75 }}>
        {props.title}{visibleIds.length ? `（${visibleIds.length}）` : ''}
      </Typography>
      {visibleIds.length ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {visibleIds.map(id => {
            const title = props.resolveTitle(id)
            const canOpen = props.canOpenId(id)
            return (
              <NoteIdChip
                key={id}
                noteId={id}
                title={title || (id ? id.slice(0, 12) + (id.length > 12 ? '…' : '') : '—')}
                onOpen={canOpen ? () => props.onOpenId(id) : undefined}
              />
            )
          })}
        </Box>
      ) : (
        <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.35)' }}>暂无</Typography>
      )}
    </Box>
  )
}

export function NoteInfoSidebar(props: {
  noteId: string
  createdAtMs: number
  updatedAtMs: number
  outgoingIds: string[]
  backlinkIds: string[]
  resolveTitle: (id: string) => string | undefined
  canOpenId: (id: string) => boolean
  onOpenId: (id: string) => void
}) {
  const noteId = String(props.noteId || '').trim()
  return (
    <Box
      aria-label="笔记信息侧边栏"
      sx={{
        flex: '0 0 280px',
        width: 280,
        minWidth: 280,
      }}
    >
      <Box
        sx={{
          position: 'sticky',
          top: 12,
          p: 2,
        }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.55)', mb: 1.25 }}>
          引用关系
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <NoteRefSection title="本笔记引用" ids={props.outgoingIds} resolveTitle={props.resolveTitle} canOpenId={props.canOpenId} onOpenId={props.onOpenId} />
          <NoteRefSection title="引用本笔记" ids={props.backlinkIds} resolveTitle={props.resolveTitle} canOpenId={props.canOpenId} onOpenId={props.onOpenId} />
        </Box>

        <Box sx={{ my: 1.5, borderTop: '1px solid rgba(0,0,0,.08)' }} />

        <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.55)', mb: 1 }}>
          笔记信息
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)' }}>创建时间</Typography>
            <Typography sx={{ fontSize: 13, color: '#111', fontWeight: 700 }}>{formatDateTime(props.createdAtMs)}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)' }}>最后修改</Typography>
            <Typography sx={{ fontSize: 13, color: '#111', fontWeight: 700 }}>{formatDateTime(props.updatedAtMs)}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)' }}>笔记 ID</Typography>
            <Typography
              component="code"
              sx={{
                display: 'block',
                fontSize: 12,
                color: '#111',
                fontWeight: 700,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap',
              }}
            >
              {noteId || '—'}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
