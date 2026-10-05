import * as React from 'react'
import { type NoteMeta } from '../core'
import type { HyperCortexGateway } from '../gateway'
import type { NoteCardInfo } from './noteCardInfo'
import { loadNoteCardInfo, startPrefetchNoteCardInfo } from './noteCardInfoLoader'
import type { NoteDetailSessionHandle } from './NoteDetailSession'
import type { PageId } from './workspacePages'

// 笔记会话句柄注册与脏/保存状态、全部笔记卡片信息缓存（加载刷新预取）。
// 由 useNoteSessions 装配调用，只经显式入参连接，不引入隐式全局。

type Params = {
  visible: boolean
  visiblePage: PageId
  gateway: HyperCortexGateway
  faceKindOrder: readonly string[]
  allNotes: NoteMeta[]
}

export function useNoteSessionHandles(params: Params) {
  const { visible, visiblePage, gateway, faceKindOrder, allNotes } = params

  const noteSessionHandlesRef = React.useRef<Record<string, NoteDetailSessionHandle | null>>({})

  const [noteDirtyById, setNoteDirtyById] = React.useState<Record<string, boolean>>({})
  const handleNoteDirtyChange = React.useCallback((payload: { noteId: string; dirty: boolean }) => {
    const nid = String(payload?.noteId || '').trim()
    if (!nid) return
    const nextDirty = payload?.dirty === true
    setNoteDirtyById(prev => {
      const had = Object.prototype.hasOwnProperty.call(prev, nid)
      const prevValue = had ? prev[nid] === true : false
      if (had && prevValue === nextDirty) return prev
      return { ...prev, [nid]: nextDirty }
    })
  }, [])

  const noteSessionRefCallbacksRef = React.useRef<Record<string, (handle: NoteDetailSessionHandle | null) => void>>({})
  const setNoteSessionHandle = React.useCallback((noteId: string, handle: NoteDetailSessionHandle | null) => {
    const nid = String(noteId || '').trim()
    if (!nid) return
    if (!handle) {
      delete noteSessionHandlesRef.current[nid]
      setNoteDirtyById(prev => {
        if (!Object.prototype.hasOwnProperty.call(prev, nid)) return prev
        const next = { ...prev }
        delete next[nid]
        return next
      })
      return
    }
    noteSessionHandlesRef.current[nid] = handle
  }, [])

  const getNoteSessionRefCallback = React.useCallback((noteId: string) => {
    const nid = String(noteId || '').trim()
    if (!nid) return undefined
    if (!noteSessionRefCallbacksRef.current[nid]) {
      noteSessionRefCallbacksRef.current[nid] = (handle: NoteDetailSessionHandle | null) => {
        setNoteSessionHandle(nid, handle)
      }
    }
    return noteSessionRefCallbacksRef.current[nid]
  }, [setNoteSessionHandle])

  const isNoteDirtyById = React.useCallback((noteId: string): boolean => {
    const nid = String(noteId || '').trim()
    if (!nid) return false
    if (Object.prototype.hasOwnProperty.call(noteDirtyById, nid)) return noteDirtyById[nid] === true
    return noteSessionHandlesRef.current[nid]?.isDirty?.() === true
  }, [noteDirtyById])

  const isNoteSavingById = React.useCallback((noteId: string): boolean => {
    const nid = String(noteId || '').trim()
    if (!nid) return false
    return noteSessionHandlesRef.current[nid]?.isSaving?.() === true
  }, [])

  // ---- 全部笔记：卡片摘要（tags / faces）
  const [noteCardInfoById, setNoteCardInfoById] = React.useState<Record<string, NoteCardInfo>>({})
  const noteCardInfoByIdRef = React.useRef<Record<string, NoteCardInfo>>({})
  React.useEffect(() => {
    noteCardInfoByIdRef.current = noteCardInfoById
  }, [noteCardInfoById])

  const upsertNoteCardInfo = React.useCallback((noteId: string, nextInfo: NoteCardInfo) => {
    const nid = String(noteId || '').trim()
    if (!nid) return
    setNoteCardInfoById(prev => {
      const existed = prev[nid]
      if (
        existed &&
        existed.faceLabels.join('\n') === nextInfo.faceLabels.join('\n') &&
        existed.faceIds.join('\n') === nextInfo.faceIds.join('\n') &&
        existed.tags.join('\n') === nextInfo.tags.join('\n')
      ) return prev
      return { ...prev, [nid]: nextInfo }
    })
  }, [])

  const refreshNoteCardInfo = React.useCallback(
    async (meta: NoteMeta) => {
      const nid = String(meta?.id || '').trim()
      if (!nid) return
      const info = await loadNoteCardInfo(gateway.notes, 'library', meta, faceKindOrder).catch(() => null)
      if (!info) return
      upsertNoteCardInfo(nid, info)
    },
    [faceKindOrder, gateway, upsertNoteCardInfo],
  )

  const ensureNoteCardInfoLoaded = React.useCallback(
    async (meta: NoteMeta) => {
      const nid = String(meta?.id || '').trim()
      if (!nid) return
      if (noteCardInfoByIdRef.current[nid]) return
      await refreshNoteCardInfo(meta)
    },
    [refreshNoteCardInfo],
  )

  React.useEffect(() => {
    if (!visible) return
    if (visiblePage !== 'all-notes') return
    const ctl = startPrefetchNoteCardInfo({
      notes: allNotes,
      getInfoById: id => noteCardInfoByIdRef.current[id],
      refresh: ensureNoteCardInfoLoaded,
      maxWorkers: 6,
    })
    return () => ctl.cancel()
  }, [allNotes, ensureNoteCardInfoLoaded, visible, visiblePage])

  const noteIndexMap = React.useMemo(() => {
    const map: Record<string, { title: string; faceIds: string[] }> = {}
    for (const n of allNotes) {
      map[n.id] = { title: n.title, faceIds: noteCardInfoById[n.id]?.faceIds || [] }
    }
    return map
  }, [allNotes, noteCardInfoById])

  return {
    noteSessionHandlesRef,
    handleNoteDirtyChange,
    getNoteSessionRefCallback,
    isNoteDirtyById,
    isNoteSavingById,
    noteCardInfoById,
    refreshNoteCardInfo,
    ensureNoteCardInfoLoaded,
    noteIndexMap,
  }
}
