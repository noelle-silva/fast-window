import * as React from 'react'

import type { HyperCortexNoteFaceManifestV2 } from '../../noteFaces'
import type { FaceDeclaration, FaceToolbarProps, FaceViewContext } from '../../facePlugins'
import type { HyperCortexFavoritesDocV1 } from '../../favorites'
import { NoteDetailTopBar } from './NoteDetailTopBar'
import type { NoteFaceId } from './noteDetailTools'

/**
 * 笔记详情顶栏接线：把会话的原始状态与动作收拢为顶栏所需的入参，
 * 顶栏自身的渲染仍交给 NoteDetailTopBar。
 */
export type NoteDetailTopBarHostProps = {
  loading: boolean
  loadError: string | null
  loaded: boolean
  editing: boolean
  saving: boolean
  dirty: boolean
  isDraft: boolean
  packageAvailable: boolean
  faceEditing: boolean
  onToggleMode: () => void
  onSave: () => void
  onSaveAllFaces: () => void
  onDiscard: () => void
  /** 本地未保存改动与外部改动冲突：黄点旁亮绿点，点开三栏对照窗。 */
  conflict: boolean
  onOpenConflict: () => void
  FaceToolbarLeft: React.ComponentType<FaceToolbarProps> | null
  FaceToolbarRight: React.ComponentType<FaceToolbarProps> | null
  faceViewState: Record<string, unknown>
  onFaceViewStateChange: (patch: Record<string, unknown>) => void
  faceViewContext: FaceViewContext
  moreMenuOpen: boolean
  moreMenuAnchorEl: HTMLElement | null
  setMoreMenuAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  closeMoreMenu: () => void
  requestOpenNoteDir: () => void
  requestOpenVersionHistory: () => void
  requestOpenLocalGraph: () => void
  setNoteSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  favoritesDoc?: HyperCortexFavoritesDocV1 | null
  openFavoritesPicker: () => void
  requestDeleteNote: () => void
  deletableFaceIds: string[]
  deleteFaceMenuOpen: boolean
  deleteFaceMenuAnchorEl: HTMLElement | null
  setDeleteFaceMenuAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  requestDeleteFace: (faceId: string) => void
  handleCopyNoteRef: () => void
  infoSidebarVisible: boolean
  setInfoSidebarVisible: React.Dispatch<React.SetStateAction<boolean>>
  addFaceSelectorVisible: boolean
  setAddFaceSelectorVisible: React.Dispatch<React.SetStateAction<boolean>>
  creatableFaceDeclarations: readonly FaceDeclaration[]
  pendingAddFace: NoteFaceId | null
  setPendingAddFace: React.Dispatch<React.SetStateAction<NoteFaceId | null>>
  handleAddFace: (kind?: string) => void
  face: NoteFaceId
  faces: NoteFaceId[]
  faceManifests: Record<string, HyperCortexNoteFaceManifestV2>
  setFace: React.Dispatch<React.SetStateAction<NoteFaceId>>
  copyFaceRef: (faceId: string) => void
}

export function NoteDetailTopBarHost(props: NoteDetailTopBarHostProps): React.ReactNode {
  const {
    loading,
    loadError,
    loaded,
    editing,
    saving,
    dirty,
    isDraft,
    packageAvailable,
    faceEditing,
    onToggleMode,
    onSave,
    onSaveAllFaces,
    onDiscard,
    conflict,
    onOpenConflict,
    FaceToolbarLeft,
    FaceToolbarRight,
    faceViewState,
    onFaceViewStateChange,
    faceViewContext,
    moreMenuOpen,
    moreMenuAnchorEl,
    setMoreMenuAnchorEl,
    closeMoreMenu,
    requestOpenNoteDir,
    requestOpenVersionHistory,
    requestOpenLocalGraph,
    setNoteSettingsOpen,
    favoritesDoc,
    openFavoritesPicker,
    requestDeleteNote,
    deletableFaceIds,
    deleteFaceMenuOpen,
    deleteFaceMenuAnchorEl,
    setDeleteFaceMenuAnchorEl,
    requestDeleteFace,
    handleCopyNoteRef,
    infoSidebarVisible,
    setInfoSidebarVisible,
    addFaceSelectorVisible,
    setAddFaceSelectorVisible,
    creatableFaceDeclarations,
    pendingAddFace,
    setPendingAddFace,
    handleAddFace,
    face,
    faces,
    faceManifests,
    setFace,
    copyFaceRef,
  } = props

  return (
    <NoteDetailTopBar
      loading={loading}
      loadError={loadError}
      loaded={loaded}
      editing={editing}
      saving={saving}
      dirty={dirty}
      isDraft={isDraft}
      packageAvailable={packageAvailable}
      faceEditing={faceEditing}
      onToggleMode={onToggleMode}
      onSave={onSave}
      onSaveAllFaces={onSaveAllFaces}
      onDiscard={onDiscard}
      conflict={conflict}
      onOpenConflict={onOpenConflict}
      FaceToolbarLeft={FaceToolbarLeft}
      FaceToolbarRight={FaceToolbarRight}
      faceViewState={faceViewState}
      onFaceViewStateChange={onFaceViewStateChange}
      faceViewContext={faceViewContext}
      moreMenuOpen={moreMenuOpen}
      moreMenuAnchorEl={moreMenuAnchorEl}
      onMoreMenuOpen={setMoreMenuAnchorEl}
      onMoreMenuClose={closeMoreMenu}
      onOpenNoteDir={requestOpenNoteDir}
      onOpenVersionHistory={requestOpenVersionHistory}
      onOpenLocalGraph={requestOpenLocalGraph}
      onOpenNoteSettings={() => setNoteSettingsOpen(true)}
      canFavorite={!!favoritesDoc}
      onOpenFavorites={openFavoritesPicker}
      onRequestDeleteNote={requestDeleteNote}
      deletableFaceIds={deletableFaceIds}
      deleteFaceMenuOpen={deleteFaceMenuOpen}
      deleteFaceMenuAnchorEl={deleteFaceMenuAnchorEl}
      onDeleteFaceMenuOpen={setDeleteFaceMenuAnchorEl}
      onDeleteFaceMenuClose={() => setDeleteFaceMenuAnchorEl(null)}
      onRequestDeleteFace={requestDeleteFace}
      onCopyNoteRef={handleCopyNoteRef}
      infoSidebarVisible={infoSidebarVisible}
      onToggleInfoSidebar={() => setInfoSidebarVisible(prev => !prev)}
      addFaceSelectorVisible={addFaceSelectorVisible}
      onToggleAddFaceSelector={() => setAddFaceSelectorVisible(prev => !prev)}
      creatableFaceDeclarations={creatableFaceDeclarations}
      pendingAddFace={pendingAddFace}
      onPickAddFace={setPendingAddFace}
      onConfirmAddFace={() => void handleAddFace()}
      face={face}
      faces={faces}
      faceManifests={faceManifests}
      onSelectFace={setFace}
      onCopyFaceRef={copyFaceRef}
    />
  )
}
