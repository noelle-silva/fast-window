import { Box, TextField, Typography } from '@mui/material'
import type { NoteBacklinkRef } from '../noteRefs'

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
  stale?: boolean
  badge?: string
  onOpen?: () => void
}) {
  const { noteId, title, stale, badge, onOpen } = props
  const clickable = typeof onOpen === 'function'
  const displayTitle = title || (noteId ? noteId.slice(0, 12) + (noteId.length > 12 ? '…' : '') : '—')
  return (
    <Box
      component="span"
      onClick={clickable ? onOpen : undefined}
      title={stale ? '此面已失效，点击仍可打开笔记' : undefined}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.25,
        py: 0.5,
        borderRadius: 999,
        fontSize: 12,
        color: stale ? 'rgba(0,0,0,.38)' : clickable ? 'var(--hc-primary)' : 'var(--hc-text-muted)',
        bgcolor: stale ? 'var(--hc-surface-soft)' : clickable ? 'var(--hc-primary-soft)' : 'var(--hc-surface-soft)',
        cursor: clickable ? 'pointer' : 'default',
        textDecoration: stale ? 'line-through' : 'none',
        transition: 'background 120ms',
        '&:hover': clickable ? (stale ? { bgcolor: 'var(--hc-surface-muted)' } : { bgcolor: 'var(--hc-primary-hover)' }) : {},
      }}
    >
      {stale ? `此面已失效：${displayTitle}` : displayTitle}
      {badge ? (
        <Box
          component="span"
          sx={{
            ml: 0.5,
            px: 0.5,
            borderRadius: 999,
            fontSize: 9,
            lineHeight: 1.4,
            fontWeight: 700,
            color: 'rgba(0,0,0,.38)',
            bgcolor: 'rgba(0,0,0,.06)',
            userSelect: 'none',
          }}
        >
          {badge}
        </Box>
      ) : null}
    </Box>
  )
}

function NoteRefSection(props: {
  title: string
  ids: string[]
  isStaleId?: (id: string) => boolean
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
                stale={!!props.isStaleId?.(id)}
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

function NoteBacklinkList(props: {
  title: string
  refs: NoteBacklinkRef[]
  isStaleRef?: (ref: NoteBacklinkRef) => boolean
  resolveTitle: (id: string) => string | undefined
  canOpenId: (id: string) => boolean
  onOpenRef: (ref: NoteBacklinkRef) => void
}) {
  const refs = Array.from(new Map((props.refs || []).map(ref => [String(ref.noteId || '').trim(), ref])).values()).filter(ref => !!ref.noteId)
  const visibleRefs = refs.filter(ref => props.canOpenId(ref.noteId))
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)', mb: 0.75 }}>
        {props.title}{visibleRefs.length ? `（${visibleRefs.length}）` : ''}
      </Typography>
      {visibleRefs.length ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {visibleRefs.map(ref => {
            const id = ref.noteId
            const title = props.resolveTitle(id)
            const stale = !!props.isStaleRef?.(ref)
            return (
              <NoteIdChip
                key={id}
                noteId={id}
                title={title || (id ? id.slice(0, 12) + (id.length > 12 ? '…' : '') : '—')}
                stale={stale}
                badge={stale ? undefined : ref.faceId || undefined}
                onOpen={() => props.onOpenRef(ref)}
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
  description: string
  editing: boolean
  createdAtMs: number
  updatedAtMs: number
  outgoingIds: string[]
  allBacklinks: NoteBacklinkRef[]
  faceBacklinkGroups: { faceId: string; label: string; refs: NoteBacklinkRef[] }[]
  onDescriptionChange: (value: string) => void
  resolveTitle: (id: string) => string | undefined
  canOpenId: (id: string) => boolean
  onOpenId: (id: string) => void
  onOpenRef: (ref: NoteBacklinkRef) => void
  isBacklinkStale?: (ref: NoteBacklinkRef) => boolean
}) {
  const noteId = String(props.noteId || '').trim()
  return (
    <Box aria-label="笔记信息侧边栏" sx={{ width: '100%', p: 2, boxSizing: 'border-box' }}>
      <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.55)', mb: 1.25 }}>
        引用关系
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <NoteRefSection title="本笔记引用" ids={props.outgoingIds} resolveTitle={props.resolveTitle} canOpenId={props.canOpenId} onOpenId={props.onOpenId} />
        <NoteBacklinkList
          title="全部引用"
          refs={props.allBacklinks}
          isStaleRef={props.isBacklinkStale}
          resolveTitle={props.resolveTitle}
          canOpenId={props.canOpenId}
          onOpenRef={props.onOpenRef}
        />
        {props.faceBacklinkGroups.map(group => (
          <NoteBacklinkList
            key={group.faceId}
            title={group.label}
            refs={group.refs}
            resolveTitle={props.resolveTitle}
            canOpenId={props.canOpenId}
            onOpenRef={props.onOpenRef}
          />
        ))}
      </Box>

      <Box sx={{ mt: 2.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'rgba(0,0,0,.55)' }}>
          笔记信息
        </Typography>
        <Box>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.42)', mb: 0.5 }}>描述</Typography>
          {props.editing ? (
            <TextField
              fullWidth
              multiline
              minRows={3}
              value={props.description}
              onChange={e => props.onDescriptionChange(e.target.value)}
              placeholder="给这条笔记写一句描述"
              inputProps={{ 'aria-label': '编辑笔记描述' }}
            />
          ) : (
            <Typography sx={{ fontSize: 13, color: '#111', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {String(props.description || '').trim() || '—'}
            </Typography>
          )}
        </Box>
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
  )
}