import * as React from 'react'

import { buildNotePlaceholderForCopy } from '../notePlaceholder'
import type { HyperCortexGateway } from '../gateway'
import type { NoteMeta, VaultScope } from '../core'
import type { HyperCortexNoteManifestV1 } from '../noteSchema'
import type { HyperCortexNoteFaceManifestV2 } from '../noteFaces'
import type { FaceContentStore } from '../facePlugins'
import type { HyperCortexFavoritesDocV1 } from '../favorites'
import type { NoteFaceId } from './note-detail/noteDetailTools'
import type { NoteDetailSnapshotV1 } from './NoteDetailSession'
import { useFavoriteTargets } from './useFavoriteTargets'

/** 笔记详情会话的工具栏与设置接线：文件菜单、删除、收藏、版本历史与设置动作。 */
export type UseNoteDetailToolbarInput = {
  gateway: HyperCortexGateway
  scope: VaultScope
  note: NoteMeta
  noteId: string
  isDraft: boolean
  trashEnabled: boolean
  saving: boolean
  deleting: 'note' | 'face' | ''
  setDeleting: React.Dispatch<React.SetStateAction<'note' | 'face' | ''>>
  face: NoteFaceId
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  editTitle: string
  favoritesDoc?: HyperCortexFavoritesDocV1 | null
  onFavoriteSaved?: (doc: HyperCortexFavoritesDocV1) => void
  onRequestDeleteNote: (payload: { note: NoteMeta; mode: 'trash' | 'permanent' }) => Promise<void> | void
  onSaved: (payload: { originalId: string; meta: NoteMeta; snapshotForNewId?: NoteDetailSnapshotV1 }) => void
  applyNoteManifest: (manifest: HyperCortexNoteManifestV1) => void
  resetFaceViewState: () => void
  setEditing: React.Dispatch<React.SetStateAction<boolean>>
  setAddFaceSelectorVisible: React.Dispatch<React.SetStateAction<boolean>>
  setPendingAddFace: React.Dispatch<React.SetStateAction<NoteFaceId | null>>
  faceStoresRef: React.MutableRefObject<Record<string, FaceContentStore>>
  faceSavedContentsRef: React.MutableRefObject<Record<string, string>>
  readNotePackage: (packageDir: string) => Promise<{
    manifest: HyperCortexNoteManifestV1
    stores: Record<string, FaceContentStore>
    savedContents: Record<string, string>
  }>
  applyLoadedNote: (manifest: HyperCortexNoteManifestV1, stores: Record<string, FaceContentStore>, savedContents: Record<string, string>) => void
}

export type NoteDetailToolbar = {
  moreMenuOpen: boolean
  moreMenuAnchorEl: HTMLElement | null
  setMoreMenuAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  closeMoreMenu: () => void
  deleteFaceMenuOpen: boolean
  deleteFaceMenuAnchorEl: HTMLElement | null
  setDeleteFaceMenuAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  requestOpenNoteDir: () => Promise<void>
  requestOpenVersionHistory: () => void
  favoritesTargets: ReturnType<typeof useFavoriteTargets>
  openFavoritesPicker: () => void
  requestDeleteNote: () => void
  requestDeleteFace: (faceId: string) => void
  deleteNoteConfirmOpen: boolean
  setDeleteNoteConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>
  deleteFaceTarget: NoteFaceId | null
  setDeleteFaceTarget: React.Dispatch<React.SetStateAction<NoteFaceId | null>>
  confirmDeleteNote: () => Promise<void>
  confirmDeleteFace: () => Promise<void>
  versionHistoryOpen: boolean
  setVersionHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>
  noteSettingsOpen: boolean
  setNoteSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  handleRestoreVersion: (versionId: string) => Promise<void>
  updateFaceSettings: (patch: Record<string, unknown | null>) => Promise<void>
  handleCopyNoteRef: () => void
  copyFaceRef: (faceId: string) => void
}

export function useNoteDetailToolbar(input: UseNoteDetailToolbarInput): NoteDetailToolbar {
  const {
    gateway,
    scope,
    note,
    noteId,
    isDraft,
    trashEnabled,
    saving,
    deleting,
    setDeleting,
    face,
    faceManifests,
    editTitle,
    favoritesDoc,
    onFavoriteSaved,
    onRequestDeleteNote,
    onSaved,
    applyNoteManifest,
    resetFaceViewState,
    setEditing,
    setAddFaceSelectorVisible,
    setPendingAddFace,
    faceStoresRef,
    faceSavedContentsRef,
    readNotePackage,
    applyLoadedNote,
  } = input

  const [moreMenuAnchorEl, setMoreMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const moreMenuOpen = !!moreMenuAnchorEl
  const [deleteFaceMenuAnchorEl, setDeleteFaceMenuAnchorEl] = React.useState<HTMLElement | null>(null)
  const deleteFaceMenuOpen = !!deleteFaceMenuAnchorEl
  const closeMoreMenu = React.useCallback(() => {
    setMoreMenuAnchorEl(null)
    setDeleteFaceMenuAnchorEl(null)
  }, [])

  const [deleteNoteConfirmOpen, setDeleteNoteConfirmOpen] = React.useState(false)
  const [deleteFaceTarget, setDeleteFaceTarget] = React.useState<NoteFaceId | null>(null)
  const [versionHistoryOpen, setVersionHistoryOpen] = React.useState(false)
  const [noteSettingsOpen, setNoteSettingsOpen] = React.useState(false)

  const requestDeleteNote = React.useCallback(() => {
    closeMoreMenu()
    setDeleteNoteConfirmOpen(true)
  }, [closeMoreMenu])

  const requestOpenNoteDir = React.useCallback(async () => {
    closeMoreMenu()
    const dir = String(note.dir || '').trim()
    if (isDraft || !dir) {
      void gateway.host.toast('草稿暂无所在目录（请先保存）')
      return
    }
    try {
      await gateway.host.openVaultDir(scope, dir)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '打开目录失败'))
    }
  }, [closeMoreMenu, gateway, isDraft, note.dir, scope])

  const requestOpenVersionHistory = React.useCallback(() => {
    closeMoreMenu()
    if (isDraft || !String(note.dir || '').trim()) {
      void gateway.host.toast('请先保存笔记，再发布版本')
      return
    }
    setVersionHistoryOpen(true)
  }, [closeMoreMenu, gateway, isDraft, note.dir])

  const favoritesTargets = useFavoriteTargets({
    doc: favoritesDoc,
    onDocChange: next => onFavoriteSaved?.(next),
    toast: message => void gateway.host.toast(message),
  })

  const openFavoritesPicker = React.useCallback(() => {
    closeMoreMenu()
    favoritesTargets.openPicker({ kind: 'note', id: note.id })
  }, [closeMoreMenu, favoritesTargets, note.id])

  const confirmDeleteNote = React.useCallback(async () => {
    if (deleting || saving) return
    setDeleting('note')
    try {
      const mode: 'trash' | 'permanent' = trashEnabled ? 'trash' : 'permanent'
      await onRequestDeleteNote({ note, mode })
      setDeleteNoteConfirmOpen(false)
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '删除失败'))
    } finally {
      setDeleting('')
    }
  }, [deleting, gateway, note, onRequestDeleteNote, saving, trashEnabled])

  const requestDeleteFace = React.useCallback((faceId: string) => {
    closeMoreMenu()
    setDeleteFaceTarget(String(faceId || '').trim() || null)
  }, [closeMoreMenu])

  const confirmDeleteFace = React.useCallback(async () => {
    const targetFaceId = String(deleteFaceTarget || '').trim()
    const dir = String(note.dir || '').trim()
    if (!targetFaceId || !dir || deleting || saving) return
    setDeleting('face')
    try {
      const mode: 'trash' | 'permanent' = trashEnabled ? 'trash' : 'permanent'
      const result = await gateway.notes.deleteNoteFace(scope, dir, targetFaceId, mode)
      delete faceStoresRef.current[targetFaceId]
      delete faceSavedContentsRef.current[targetFaceId]
      applyNoteManifest(result.manifest)
      setAddFaceSelectorVisible(false)
      setPendingAddFace(null)
      setDeleteFaceTarget(null)
      onSaved({ originalId: noteId, meta: result.meta })
      void gateway.host.toast(mode === 'trash' ? '已移入回收站（可在回收站恢复）' : '已删除面')
    } catch (e: any) {
      void gateway.host.toast(String(e?.message || e || '删除面失败'))
    } finally {
      setDeleting('')
    }
  }, [applyNoteManifest, deleteFaceTarget, deleting, gateway, note.dir, noteId, onSaved, saving, scope, trashEnabled])

  const updateFaceSettings = React.useCallback(async (patch: Record<string, unknown | null>) => {
    const dir = String(note.dir || '').trim()
    const faceId = String(face || '').trim()
    if (!dir || !faceId) return
    const result = await gateway.notes.saveFaceSettings(scope, dir, faceId, patch)
    applyNoteManifest(result.manifest)
  }, [applyNoteManifest, face, gateway, note.dir, scope])

  const handleRestoreVersion = React.useCallback(async (versionId: string) => {
    const dir = String(note.dir || '').trim()
    if (!dir) throw new Error('请先保存笔记，再恢复版本')
    const result = await gateway.notes.restoreNoteVersion(scope, dir, versionId)
    // 恢复已落盘：经统一读取通道重建会话内容与基线，不再维护第二套装载逻辑。
    const { manifest, stores, savedContents } = await readNotePackage(result.meta.dir)
    applyLoadedNote(manifest, stores, savedContents)
    setEditing(false)
    resetFaceViewState()

    onSaved({ originalId: noteId, meta: result.meta })
  }, [applyLoadedNote, gateway, note.dir, noteId, onSaved, readNotePackage, resetFaceViewState, scope])

  const handleCopyNoteRef = React.useCallback(() => {
    void gateway.clipboard.writeText(buildNotePlaceholderForCopy(noteId, editTitle || note.title || ''))
    void gateway.host.toast('已复制引用占位符')
  }, [editTitle, gateway, note.title, noteId])

  const copyFaceRef = React.useCallback((faceId: string) => {
    const face = String(faceId || '').trim()
    if (!face) return
    const title = editTitle || note.title || ''
    void gateway.clipboard.writeText(buildNotePlaceholderForCopy(noteId, title, face))
    void gateway.host.toast('已复制此面引用占位符')
  }, [editTitle, gateway, note.title, noteId])

  return {
    moreMenuOpen,
    moreMenuAnchorEl,
    setMoreMenuAnchorEl,
    closeMoreMenu,
    deleteFaceMenuOpen,
    deleteFaceMenuAnchorEl,
    setDeleteFaceMenuAnchorEl,
    requestOpenNoteDir,
    requestOpenVersionHistory,
    favoritesTargets,
    openFavoritesPicker,
    requestDeleteNote,
    requestDeleteFace,
    deleteNoteConfirmOpen,
    setDeleteNoteConfirmOpen,
    deleteFaceTarget,
    setDeleteFaceTarget,
    confirmDeleteNote,
    confirmDeleteFace,
    versionHistoryOpen,
    setVersionHistoryOpen,
    noteSettingsOpen,
    setNoteSettingsOpen,
    handleRestoreVersion,
    updateFaceSettings,
    handleCopyNoteRef,
    copyFaceRef,
  }
}
