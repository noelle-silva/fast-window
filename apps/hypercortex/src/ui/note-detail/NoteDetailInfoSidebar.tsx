import * as React from 'react'
import { Box } from '@mui/material'

import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import type { NoteMeta } from '../../core'
import { isBacklinkStaleFromRelations, type NoteBacklinkRef, type NoteRefRelationEdge } from '../../noteRefs'
import { NoteInfoSidebar } from '../NoteInfoSidebar'

/**
 * 笔记详情信息侧栏：引用关系与笔记信息的展示接线。
 * 纯展示组件：数据与回调全部由会话注入。
 */
export type NoteDetailInfoSidebarProps = {
  infoSidebarVisible: boolean
  noteId: string
  editDescription: string
  editing: boolean
  noteTimes: { createdAtMs: number; updatedAtMs: number }
  outgoingIds: string[]
  allBacklinks: NoteBacklinkRef[]
  faceBacklinkGroups: { faceId: string; label: string; refs: NoteBacklinkRef[] }[]
  setEditDescription: React.Dispatch<React.SetStateAction<string>>
  allNotesById: Record<string, NoteMeta>
  onOpenNote: (note: NoteMeta, faceId?: string) => void
  backlinkEdges: NoteRefRelationEdge[]
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
}

export function NoteDetailInfoSidebar(props: NoteDetailInfoSidebarProps): React.ReactNode {
  const {
    infoSidebarVisible,
    noteId,
    editDescription,
    editing,
    noteTimes,
    outgoingIds,
    allBacklinks,
    faceBacklinkGroups,
    setEditDescription,
    allNotesById,
    onOpenNote,
    backlinkEdges,
    faceManifests,
  } = props

  if (!infoSidebarVisible) return null

  return (
    <Box sx={{ flex: '0 0 280px', width: 280, minWidth: 280, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}>
      <NoteInfoSidebar
        noteId={noteId}
        description={editDescription}
        editing={editing}
        createdAtMs={noteTimes.createdAtMs}
        updatedAtMs={noteTimes.updatedAtMs}
        outgoingIds={outgoingIds}
        allBacklinks={allBacklinks}
        faceBacklinkGroups={faceBacklinkGroups}
        onDescriptionChange={setEditDescription}
        resolveTitle={id => allNotesById[id]?.title}
        canOpenId={id => !!allNotesById[id]}
        onOpenId={id => {
          const meta = allNotesById[id]
          if (meta) onOpenNote(meta)
        }}
        onOpenRef={ref => {
          const meta = allNotesById[ref.noteId]
          if (meta) onOpenNote(meta, ref.faceId || undefined)
        }}
        isBacklinkStale={ref => isBacklinkStaleFromRelations(backlinkEdges, noteId, ref.noteId, faceId => !!faceManifests[String(faceId || '').trim()])}
      />
    </Box>
  )
}
