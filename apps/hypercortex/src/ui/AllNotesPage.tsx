import * as React from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import type { NoteMeta } from '../core'
import type { NoteCardInfo } from './noteCardInfo'
import { AllNotesGridNoteCard, AllNotesIconNoteCard, AllNotesListNoteRow } from './AllNotesNoteCard'

export type AllNotesLayout = 'list' | 'grid' | 'icon'

// 「全部笔记」页面主体：独立页面与模态窗共用同一份身体。
export function AllNotesPage(props: {
  notes: NoteMeta[]
  loading?: boolean
  errorText?: string | null
  layout: AllNotesLayout
  noteCardInfoById: Record<string, NoteCardInfo>
  onLayoutToggle: () => void
  onOpenNote: (note: NoteMeta) => void
  onCopyRef: (note: NoteMeta) => void
  onMore: (event: React.MouseEvent, note: NoteMeta) => void
  filterText?: string
  picker?: {
    alreadyIds: ReadonlySet<string>
    onPick: (note: NoteMeta) => void
  }
}) {
  const { notes, loading, errorText, layout, noteCardInfoById, onLayoutToggle, onOpenNote, onCopyRef, onMore, filterText = '', picker } = props
  const hasError = !!errorText
  const filteredNotes = React.useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(note =>
      [String(note.title || ''), String(note.id || ''), String(note.description || '')].join(' ').toLowerCase().includes(q),
    )
  }, [filterText, notes])
  const hasItems = !loading && !hasError && filteredNotes.length > 0
  const renderNote = (note: NoteMeta): React.ReactNode => {
    const picked = picker ? picker.alreadyIds.has(note.id) : undefined
    const openNote = picker ? () => picker.onPick(note) : () => onOpenNote(note)
    const card =
      layout === 'list' ? (
        <AllNotesListNoteRow note={note} info={noteCardInfoById[note.id]} onOpen={openNote} onCopyRef={picker ? undefined : onCopyRef} onMore={picker ? undefined : onMore} />
      ) : layout === 'icon' ? (
        <AllNotesIconNoteCard note={note} info={noteCardInfoById[note.id]} onOpen={openNote} onCopyRef={picker ? undefined : onCopyRef} onMore={picker ? undefined : onMore} />
      ) : (
        <AllNotesGridNoteCard note={note} info={noteCardInfoById[note.id]} onOpen={openNote} onCopyRef={picker ? undefined : onCopyRef} onMore={picker ? undefined : onMore} />
      )
    return (
      <Box
        key={note.id}
        sx={{
          opacity: picked ? 0.55 : 1,
          position: 'relative',
        }}
      >
        {card}
        {picked ? (
          <Typography
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              px: 0.8,
              py: 0.3,
              borderRadius: 999,
              bgcolor: 'var(--hc-surface)',
              boxShadow: '0 1px 4px rgba(0,0,0,.08)',
              fontSize: 11,
              lineHeight: 1,
              fontWeight: 800,
              color: 'var(--hc-text-subtle)',
              pointerEvents: 'none',
            }}
          >
            已添加
          </Typography>
        ) : null}
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {!picker ? (
          <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>全部笔记</Typography>
        ) : null}
        {picker ? <Box sx={{ flex: 1 }} /> : null}
        <Tooltip title={layout === 'list' ? '切换到网格' : layout === 'grid' ? '切换到紧凑' : '切换到列表'} placement="left">
          <IconButton
            size="small"
            aria-label={layout === 'list' ? '切换到网格' : layout === 'grid' ? '切换到紧凑' : '切换到列表'}
            onClick={onLayoutToggle}
            sx={{
              color: 'rgba(0,0,0,.58)',
              bgcolor: 'transparent',
              boxShadow: 'none',
              border: 0,
              '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
            }}
          >
            {layout === 'list' ? (
              <ViewModuleRoundedIcon fontSize="small" />
            ) : layout === 'grid' ? (
              <AppsRoundedIcon fontSize="small" />
            ) : (
              <ViewListRoundedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Box>

      {loading ? <Typography color="text.secondary">正在加载笔记...</Typography> : null}
      {!loading && hasError ? <Typography color="error">{errorText}</Typography> : null}
      {!loading && !hasError && notes.length === 0 ? <Typography color="text.secondary">还没有笔记。</Typography> : null}
      {!loading && !hasError && notes.length > 0 && filteredNotes.length === 0 ? <Typography color="text.secondary">没有匹配的结果。</Typography> : null}

      {hasItems && layout === 'grid' ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 1,
          }}
        >
          {filteredNotes.map(renderNote)}
        </Box>
      ) : null}

      {hasItems && layout === 'icon' ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
            gap: 1,
          }}
        >
          {filteredNotes.map(renderNote)}
        </Box>
      ) : null}

      {hasItems && layout === 'list' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {filteredNotes.map(renderNote)}
        </Box>
      ) : null}
    </Box>
  )
}
