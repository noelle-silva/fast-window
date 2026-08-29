import * as React from 'react'
import { Box, Dialog, DialogContent, DialogTitle, InputBase } from '@mui/material'
import { assetRefKey } from '../../assetTypes'
import type { NoteMeta } from '../../core'
import type { HyperCortexFavoritesDocV1 } from '../../favorites'
import { getRefsByFolderId } from '../../favorites'
import type { HyperCortexGateway } from '../../gateway'
import type { NoteCardInfo } from '../noteCardInfo'
import { AssetPoolPanel } from '../AssetPoolPanel'
import { AllNotesPage, type AllNotesLayout } from '../AllNotesPage'

type Props = {
  open: boolean
  kind: 'note' | 'asset'
  gateway: HyperCortexGateway
  folderId: string
  doc: HyperCortexFavoritesDocV1
  noteIndex?: Record<string, NoteMeta>
  onClose: () => void
  onPick: (kind: 'note' | 'asset', targetId: string) => void
}

export function IndexPickerDialog(props: Props): React.ReactNode {
  const { open, kind, gateway, folderId, doc, noteIndex, onClose, onPick } = props
  const [search, setSearch] = React.useState('')
  const [noteLayout, setNoteLayout] = React.useState<AllNotesLayout>('grid')

  React.useEffect(() => {
    if (open) setSearch('')
  }, [open])

  const alreadyKeys = React.useMemo(() => {
    const refs = getRefsByFolderId(doc, folderId)
    return new Set(refs.filter(ref => ref.kind === 'asset').map(ref => ref.targetId))
  }, [doc, folderId])

  const alreadyIds = React.useMemo(() => {
    const refs = getRefsByFolderId(doc, folderId)
    return new Set(refs.filter(ref => ref.kind === 'note').map(ref => ref.targetId))
  }, [doc, folderId])

  const noteList = React.useMemo(
    () => Object.values(noteIndex || {}).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0)),
    [noteIndex],
  )

  const cycleNoteLayout = React.useCallback(() => {
    setNoteLayout(prev => (prev === 'list' ? 'grid' : prev === 'grid' ? 'icon' : 'list'))
  }, [])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{kind === 'note' ? '添加已有笔记' : '添加已有附件'}</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            borderRadius: 999,
            bgcolor: 'var(--hc-surface-soft)',
            mb: 1.25,
          }}
        >
          <InputBase
            fullWidth
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={kind === 'note' ? '搜索笔记标题或 ID' : '搜索附件名称或 key'}
            sx={{ fontSize: 13 }}
          />
        </Box>

        <Box sx={{ maxHeight: 'min(480px, 60vh)', overflowY: 'auto', pr: 0.5 }}>
          {kind === 'note' ? (
            <AllNotesPage
              notes={noteList}
              layout={noteLayout}
              noteCardInfoById={{} as Record<string, NoteCardInfo>}
              onLayoutToggle={cycleNoteLayout}
              onOpenNote={() => {}}
              onCopyRef={() => {}}
              onMore={() => {}}
              filterText={search}
              picker={{
                alreadyIds,
                onPick: note => onPick('note', note.id),
              }}
            />
          ) : (
            <AssetPoolPanel
              gateway={gateway}
              scope="library"
              filterText={search}
              picker={{
                alreadyKeys,
                onPick: asset => onPick('asset', assetRefKey(asset)),
              }}
            />
          )}
        </Box>
      </DialogContent>
    </Dialog>
  )
}
