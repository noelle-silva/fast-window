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
}) {
  const { notes, loading, errorText, layout, noteCardInfoById, onLayoutToggle, onOpenNote, onCopyRef, onMore } = props
  const hasError = !!errorText
  const hasItems = !loading && !hasError && notes.length > 0

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 24, lineHeight: 1.25, fontWeight: 900, color: '#111' }}>全部笔记</Typography>
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

      {hasItems && layout === 'grid' ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 1,
          }}
        >
          {notes.map(note => (
            <AllNotesGridNoteCard key={note.id} note={note} info={noteCardInfoById[note.id]} onOpen={onOpenNote} onCopyRef={onCopyRef} onMore={onMore} />
          ))}
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
          {notes.map(note => (
            <AllNotesIconNoteCard key={note.id} note={note} info={noteCardInfoById[note.id]} onOpen={onOpenNote} onCopyRef={onCopyRef} onMore={onMore} />
          ))}
        </Box>
      ) : null}

      {hasItems && layout === 'list' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {notes.map(note => (
            <AllNotesListNoteRow key={note.id} note={note} info={noteCardInfoById[note.id]} onOpen={onOpenNote} onCopyRef={onCopyRef} onMore={onMore} />
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
