import * as React from 'react'
import { Box, Typography } from '@mui/material'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import type { NoteMeta } from '../core'
import { isDraftNoteId } from '../drafts'

export type NoteCardInfo = {
  tags: string[]
  hasTextFace: boolean
  hasHtmlFace: boolean
}

export function noteContainsLabel(info: NoteCardInfo | null | undefined): string {
  if (!info) return ''
  const hasText = info.hasTextFace
  const hasHtml = info.hasHtmlFace
  if (hasText && hasHtml) return '文本 · HTML'
  if (hasText) return '文本'
  if (hasHtml) return 'HTML'
  return ''
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return tags.map(v => String(v || '').trim()).filter(Boolean)
}

function TagsLine(props: {
  tags?: string[]
  max?: number
  fontSize?: number
}): React.ReactNode {
  const tags = normalizeTags(props.tags)
  const max = Math.max(0, Math.floor(Number(props.max ?? 0))) || 0
  const fontSize = Number(props.fontSize) > 0 ? Number(props.fontSize) : 11
  if (!tags.length || max <= 0) return null
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {shown.map(t => (
        <Box
          key={t}
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            px: 0.9,
            py: 0.25,
            borderRadius: 999,
            fontSize,
            color: 'rgba(0,0,0,.62)',
            bgcolor: 'rgba(0,0,0,.05)',
            maxWidth: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {t}
        </Box>
      ))}
      {rest > 0 ? (
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            px: 0.9,
            py: 0.25,
            borderRadius: 999,
            fontSize,
            color: 'rgba(0,0,0,.52)',
            bgcolor: 'rgba(0,0,0,.04)',
          }}
        >
          +{rest}
        </Box>
      ) : null}
    </Box>
  )
}

function Actions(props: {
  size: number
  fontSize: number
  note: NoteMeta
  onCopyRef: (note: NoteMeta) => void
  onMore: (e: React.MouseEvent, note: NoteMeta) => void
}): React.ReactNode {
  const { size, fontSize, note, onCopyRef, onMore } = props
  return (
    <Box className="hc-note-card-actions" sx={{ display: 'flex', gap: 0.5, opacity: 0, transition: 'opacity .15s' }}>
      <Box
        component="button"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation()
          onCopyRef(note)
        }}
        sx={{
          border: 'none',
          background: 'rgba(0,0,0,.05)',
          borderRadius: 1.5,
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize,
          color: 'rgba(0,0,0,.45)',
          '&:hover': { background: 'rgba(0,0,0,.1)' },
        }}
        aria-label="复制引用占位符"
        title="复制引用占位符"
      >
        🔗
      </Box>
      <Box
        component="button"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation()
          onMore(e, note)
        }}
        sx={{
          border: 'none',
          background: 'rgba(0,0,0,.05)',
          borderRadius: 1.5,
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'rgba(0,0,0,.45)',
          '&:hover': { background: 'rgba(0,0,0,.1)' },
        }}
        aria-label="更多操作"
        title="更多操作"
      >
        <MoreHorizRoundedIcon sx={{ fontSize: Math.max(12, Math.floor(size * 0.68)) }} />
      </Box>
    </Box>
  )
}

function containsTextFor(info: NoteCardInfo | null | undefined): string {
  return info ? (noteContainsLabel(info) || '—') : '…'
}

function showContainsForNote(note: NoteMeta): boolean {
  return !isDraftNoteId(note.id) && !!String(note.dir || '').trim()
}

export function AllNotesGridNoteCard(props: {
  note: NoteMeta
  info?: NoteCardInfo
  onOpen: (note: NoteMeta) => void
  onCopyRef: (note: NoteMeta) => void
  onMore: (e: React.MouseEvent, note: NoteMeta) => void
}): React.ReactNode {
  const { note, info, onOpen, onCopyRef, onMore } = props
  const tags = normalizeTags(info?.tags)
  const containsText = containsTextFor(info)
  const showContains = showContainsForNote(note)

  return (
    <Box
      onClick={() => onOpen(note)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(note)
        }
      }}
      sx={{
        position: 'relative',
        minHeight: 144,
        px: 1.5,
        py: 1.5,
        borderRadius: 3,
        bgcolor: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        cursor: 'pointer',
        transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
        '&:hover': {
          bgcolor: 'rgba(0,0,0,.02)',
          boxShadow: '0 6px 16px rgba(0,0,0,.08)',
          transform: 'translateY(-1px)',
        },
        '&:hover .hc-note-card-actions': { opacity: 1 },
      }}
    >
      <Box sx={{ position: 'absolute', top: 6, right: 6 }}>
        <Actions size={24} fontSize={13} note={note} onCopyRef={onCopyRef} onMore={onMore} />
      </Box>

      <Typography
        sx={{
          fontSize: 14,
          lineHeight: 1.5,
          fontWeight: 600,
          color: '#111',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          pr: 7,
        }}
      >
        {note.title || '未命名'}
      </Typography>

      {tags.length ? (
        <Box sx={{ mt: 0.75 }}>
          <TagsLine tags={tags} max={3} fontSize={11} />
        </Box>
      ) : null}

      {showContains ? (
        <Typography sx={{ mt: 'auto', fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.42)' }}>
          包含：{containsText}
        </Typography>
      ) : null}
    </Box>
  )
}

export function AllNotesIconNoteCard(props: {
  note: NoteMeta
  info?: NoteCardInfo
  onOpen: (note: NoteMeta) => void
  onCopyRef: (note: NoteMeta) => void
  onMore: (e: React.MouseEvent, note: NoteMeta) => void
}): React.ReactNode {
  const { note, info, onOpen, onCopyRef, onMore } = props
  const tags = normalizeTags(info?.tags)
  const containsText = containsTextFor(info)
  const showContains = showContainsForNote(note)

  return (
    <Box
      onClick={() => onOpen(note)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(note)
        }
      }}
      sx={{
        position: 'relative',
        minHeight: 84,
        px: 1.25,
        py: 1.25,
        borderRadius: 3,
        bgcolor: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        cursor: 'pointer',
        transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
        '&:hover': {
          bgcolor: 'rgba(0,0,0,.02)',
          boxShadow: '0 6px 16px rgba(0,0,0,.08)',
          transform: 'translateY(-1px)',
        },
        '&:hover .hc-note-card-actions': { opacity: 1 },
      }}
    >
      <Box sx={{ position: 'absolute', top: 4, right: 4 }}>
        <Actions size={22} fontSize={11} note={note} onCopyRef={onCopyRef} onMore={onMore} />
      </Box>

      <Typography
        sx={{
          fontSize: 13,
          lineHeight: 1.45,
          fontWeight: 600,
          color: '#111',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          px: 0.5,
          pt: 0.25,
        }}
      >
        {note.title || '未命名'}
      </Typography>

      {tags.length ? (
        <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'center' }}>
          <TagsLine tags={tags} max={2} fontSize={10.5} />
        </Box>
      ) : null}

      {showContains ? (
        <Typography sx={{ mt: 'auto', fontSize: 11.5, lineHeight: 1.6, color: 'rgba(0,0,0,.42)' }}>
          包含：{containsText}
        </Typography>
      ) : null}
    </Box>
  )
}

export function AllNotesListNoteRow(props: {
  note: NoteMeta
  info?: NoteCardInfo
  onOpen: (note: NoteMeta) => void
  onCopyRef: (note: NoteMeta) => void
  onMore: (e: React.MouseEvent, note: NoteMeta) => void
}): React.ReactNode {
  const { note, info, onOpen, onCopyRef, onMore } = props
  const tags = normalizeTags(info?.tags)
  const containsText = containsTextFor(info)
  const showContains = showContainsForNote(note)
  const showMetaLine = tags.length > 0 || showContains

  return (
    <Box
      onClick={() => onOpen(note)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(note)
        }
      }}
      sx={{
        position: 'relative',
        px: 1.5,
        py: 1.15,
        borderRadius: 3,
        bgcolor: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        cursor: 'pointer',
        transition: 'background-color .16s ease, box-shadow .16s ease, transform .16s ease',
        '&:hover': {
          bgcolor: 'rgba(0,0,0,.02)',
          boxShadow: '0 6px 16px rgba(0,0,0,.08)',
          transform: 'translateY(-1px)',
        },
        '&:hover .hc-note-card-actions': { opacity: 1 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box sx={{ flexShrink: 0 }}>
          <Actions size={24} fontSize={13} note={note} onCopyRef={onCopyRef} onMore={onMore} />
        </Box>

        <Typography
          sx={{
            fontSize: 14,
            lineHeight: 1.5,
            fontWeight: 600,
            color: '#111',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {note.title || '未命名'}
        </Typography>
      </Box>

      {showMetaLine ? (
        <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            {tags.length ? <TagsLine tags={tags} max={6} fontSize={11} /> : null}
          </Box>
          {showContains ? (
            <Typography sx={{ fontSize: 12, lineHeight: 1.6, color: 'rgba(0,0,0,.42)', flexShrink: 0 }}>
              包含：{containsText}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}
