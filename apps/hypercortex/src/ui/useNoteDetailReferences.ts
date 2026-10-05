import * as React from 'react'

import type { HyperCortexGateway } from '../gateway'
import type { NoteMeta, VaultScope } from '../core'
import type { HyperCortexNoteFaceManifestV2 } from '../noteFaces'
import { getFaceViewPlugin, resolveFaceLabel, type FaceContentStore } from '../facePlugins'
import {
  backlinksFromRelations,
  faceBacklinksFromRelations,
  type NoteBacklinkRef,
  type NoteRefRelationEdge,
} from '../noteRefs'
import type { NoteFaceId } from './note-detail/noteDetailTools'

/** 笔记详情会话的引用与反向引用：出链提取、卡片预取与后端反向引用查询。 */
export type UseNoteDetailReferencesInput = {
  gateway: HyperCortexGateway
  scope: VaultScope
  noteId: string
  visible: boolean
  refRelationsEpoch: number
  loaded: boolean
  infoSidebarVisible: boolean
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  faceDirtyVersion: number
  faceStoresRef: React.MutableRefObject<Record<string, FaceContentStore>>
  faces: NoteFaceId[]
  allNotesById: Record<string, NoteMeta>
  onEnsureNoteCardInfoLoaded?: (meta: NoteMeta) => void | Promise<void>
}

export type NoteDetailReferences = {
  outgoingIds: string[]
  backlinkEdges: NoteRefRelationEdge[]
  allBacklinks: NoteBacklinkRef[]
  faceBacklinkGroups: { faceId: string; label: string; refs: NoteBacklinkRef[] }[]
}

export function useNoteDetailReferences(input: UseNoteDetailReferencesInput): NoteDetailReferences {
  const {
    gateway,
    scope,
    noteId,
    visible,
    refRelationsEpoch,
    loaded,
    infoSidebarVisible,
    faceManifests,
    faceDirtyVersion,
    faceStoresRef,
    faces,
    allNotesById,
    onEnsureNoteCardInfoLoaded,
  } = input

  // 出链与卡片预取统一从各面草稿内容提取（未保存的引用同样可见）；按面类型派发到各自的引用解析器。
  const draftRefIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const [faceId, store] of Object.entries(faceStoresRef.current)) {
      const kind = String(faceManifests[faceId]?.kind || '').trim()
      const refs = kind ? getFaceViewPlugin(kind)?.extractRefs?.(store.getContent()) || [] : []
      for (const ref of refs) {
        const noteId = String(ref?.noteId || '').trim()
        if (noteId) ids.add(noteId)
      }
    }
    return Array.from(ids)
  }, [faceDirtyVersion, loaded, faceManifests])

  const outgoingIds = React.useMemo(() => (infoSidebarVisible ? draftRefIds : []), [draftRefIds, infoSidebarVisible])

  React.useEffect(() => {
    if (!onEnsureNoteCardInfoLoaded) return
    if (!loaded) return
    for (const id of draftRefIds) {
      const meta = allNotesById[id]
      if (!meta) continue
      try {
        void Promise.resolve(onEnsureNoteCardInfoLoaded(meta)).catch(() => {})
      } catch (_) {}
    }
  }, [allNotesById, draftRefIds, loaded, onEnsureNoteCardInfoLoaded])

  // 反向引用来自后端关系查询（引用边）：仅可见会话请求，任何笔记保存/删除/恢复后重取（refRelationsEpoch）。
  const [backlinkEdges, setBacklinkEdges] = React.useState<NoteRefRelationEdge[]>([])
  React.useEffect(() => {
    if (!visible || !noteId) return
    let cancelled = false
    void gateway.refs
      .queryRelations(scope, noteId, 1, 'incoming')
      .then(result => {
        if (!cancelled) setBacklinkEdges(Array.isArray(result?.edges) ? result.edges : [])
      })
      .catch(() => {
        if (!cancelled) setBacklinkEdges([])
      })
    return () => {
      cancelled = true
    }
  }, [gateway, noteId, refRelationsEpoch, scope, visible])

  const allBacklinks = React.useMemo(() => {
    if (!noteId) return []
    return backlinksFromRelations(backlinkEdges, noteId)
  }, [noteId, backlinkEdges])

  const faceBacklinkGroups = React.useMemo(() => {
    if (!noteId) return []
    return faces
      .map(faceId => ({
        faceId,
        label: `${resolveFaceLabel(faceId, faceManifests)}面引用`,
        refs: faceBacklinksFromRelations(backlinkEdges, noteId, faceId),
      }))
      .filter(group => group.refs.length > 0)
  }, [faces, faceManifests, noteId, backlinkEdges])

  return { outgoingIds, backlinkEdges, allBacklinks, faceBacklinkGroups }
}
