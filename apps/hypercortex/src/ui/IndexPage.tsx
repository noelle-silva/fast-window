import * as React from 'react'
import { Box, Typography } from '@mui/material'

import type { AssetEntry } from '../assetTypes'
import { type NoteMeta } from '../core'
import { buildAssetLookup, resolveAssetRef } from '../assetLookup'
import type { HyperCortexGateway } from '../gateway'
import {
  getFolderById,
  getRefsByFolderId,
  type FavoriteFolder,
  type FavoriteItemRef,
  type HyperCortexFavoritesDocV1,
} from '../favorites'
import { AssetCard } from './index-cards/AssetCard'
import { FolderCard } from './index-cards/FolderCard'
import { NoteCard } from './index-cards/NoteCard'
import { StaleRefCard } from './index-cards/StaleRefCard'
import { IndexCardShell } from './index-page/IndexCardShell'
import { IndexPageDialogs } from './index-page/IndexPageDialogs'
import { ContextMenu } from './ContextMenu'
import { IndexPickerDialog } from './index-page/IndexPickerDialog'
import { MuuriGrid } from './index-page/MuuriGrid'
import { IndexPageToolbar } from './index-page/IndexPageToolbar'
import { IndexPageAddMenus } from './index-page/IndexPageAddMenus'
import { FolderSuggestionCard } from './index-page/FolderSuggestionCard'
import type { ResizeHandleDirection } from './index-page/types'
import { useIndexLayoutEditor } from './index-page/useIndexLayoutEditor'
import { useIndexPageActions } from './index-page/useIndexPageActions'

type Props = {
  gateway: HyperCortexGateway
  activeRepoId: string
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  noteIndex?: Record<string, NoteMeta>
  assetIndex?: Record<string, any>
  onNavigateFolder: (folderId: string) => void
  onOpenNote: (note: NoteMeta) => void
  onOpenAsset: (asset: AssetEntry) => void
  onDocChange: (doc: HyperCortexFavoritesDocV1) => void
  onCreateNoteInIndex?: (folderId: string) => Promise<void> | void
  onUploadAssetsInIndex?: (folderId: string) => Promise<void> | void
  onDeleteFolderEntity?: (folderId: string) => void
  onDeleteNoteEntity?: (note: NoteMeta) => void
  onDeleteAssetEntity?: (asset: AssetEntry) => void
  onUpdateNoteInfo?: (note: NoteMeta, patch: { title: string; description: string }) => Promise<void> | void
  onUpdateAssetInfo?: (asset: AssetEntry, patch: { displayName: string; remark: string }) => Promise<void> | void
}

export function IndexPage(props: Props): React.ReactNode {
  const {
    gateway,
    activeRepoId,
    doc,
    currentFolderId,
    noteIndex,
    assetIndex,
    onNavigateFolder,
    onOpenNote,
    onOpenAsset,
    onDocChange,
    onCreateNoteInIndex,
    onUploadAssetsInIndex,
    onDeleteFolderEntity,
    onDeleteNoteEntity,
    onDeleteAssetEntity,
    onUpdateNoteInfo,
    onUpdateAssetInfo,
  } = props

  const {
    refs,
    currentTitle,
    canGoBack,
    breadcrumbItems,
    folderSuggestions,
    folderDisabledReasonById,
    contextMenu,
    openContextMenu,
    closeContextMenu,
    buildVoidMenuEntries,
    addExistingAnchorEl,
    createNewAnchorEl,
    closeAddMenus,
    openAddExistingMenu,
    openCreateNewMenu,
    addMode,
    addKind,
    addPickerKind,
    deleteFolderConfirmId,
    openAddDialog,
    openExistingPicker,
    closeAddDialog,
    createNewNote,
    uploadNewAssets,
    confirmAddFolder,
    addExistingFolder,
    confirmAddNote,
    confirmAddAsset,
    handleGoBack,
    openDeleteCurrentFolderConfirm,
    confirmDeleteCurrentFolder,
    setAddPickerKind,
    setDeleteFolderConfirmId,
    favoritesEntity,
  } = useIndexPageActions({
    gateway,
    doc,
    currentFolderId,
    onNavigateFolder,
    onDocChange,
    onCreateNoteInIndex,
    onUploadAssetsInIndex,
    onDeleteFolderEntity,
    onDeleteNoteEntity,
    onDeleteAssetEntity,
    onUpdateNoteInfo,
    onUpdateAssetInfo,
  })

  const assetLookup = React.useMemo(() => buildAssetLookup(assetIndex), [assetIndex])

  const { gridRef, draggingRefId, dropIndicatorLayout, getPreviewLayout, beginResize, previewDragLayout, commitDragPreview, cancelDragPreview, handleDragStateChange, isResizingRef } = useIndexLayoutEditor({
    refs,
    doc,
    currentFolderId,
    onDocChange,
  })

  const renderFolderSuggestionCard = React.useCallback(
    (folder: FavoriteFolder) => <FolderSuggestionCard doc={doc} folder={folder} />,
    [doc],
  )

  const renderRef = React.useCallback(
    (
      ref: FavoriteItemRef,
      options?: { dragging: boolean },
    ): React.ReactNode => {
      const onStartResize = (direction: ResizeHandleDirection, e: React.PointerEvent) => beginResize(ref, direction, e)

      if (ref.kind === 'folder') {
        const folder = getFolderById(doc, ref.targetId)
        if (!folder) {
          const compact = getPreviewLayout(ref).h <= 1
          return (
            <IndexCardShell
              dragging={options?.dragging}
              resizing={isResizingRef(ref.id)}
              onContextMenu={e => favoritesEntity.openMenu(e, { kind: 'stale', refId: ref.id })}
              onStartResize={onStartResize}
            >
              <StaleRefCard itemRef={ref} compact={compact} />
            </IndexCardShell>
          )
        }
        const refCount = getRefsByFolderId(doc, folder.id).length
        const compact = getPreviewLayout(ref).h <= 1
        return (
          <IndexCardShell
            dragging={options?.dragging}
            resizing={isResizingRef(ref.id)}
            onContextMenu={e => favoritesEntity.openMenu(e, { kind: 'folder', refId: ref.id, folderId: folder.id })}
            onStartResize={onStartResize}
          >
            <FolderCard folderId={folder.id} title={folder.title} description={folder.description} refCount={refCount} compact={compact} onClick={fid => onNavigateFolder(fid)} />
          </IndexCardShell>
        )
      }

      if (ref.kind === 'note') {
        const note = noteIndex?.[ref.targetId]
        if (!note) {
          const compact = getPreviewLayout(ref).h <= 1
          return (
            <IndexCardShell
              dragging={options?.dragging}
              resizing={isResizingRef(ref.id)}
              onContextMenu={e => favoritesEntity.openMenu(e, { kind: 'stale', refId: ref.id })}
              onStartResize={onStartResize}
            >
              <StaleRefCard itemRef={ref} compact={compact} />
            </IndexCardShell>
          )
        }
        const compact = getPreviewLayout(ref).h <= 1
        return (
          <IndexCardShell
            dragging={options?.dragging}
            resizing={isResizingRef(ref.id)}
            onContextMenu={e => favoritesEntity.openMenu(e, { kind: 'note', refId: ref.id, note })}
            onStartResize={onStartResize}
          >
            <NoteCard note={note} compact={compact} onClick={onOpenNote} />
          </IndexCardShell>
        )
      }

      if (ref.kind === 'asset') {
        const asset = resolveAssetRef(assetLookup, ref.targetId)
        if (!asset) {
          const compact = getPreviewLayout(ref).h <= 1
          return (
            <IndexCardShell
              dragging={options?.dragging}
              resizing={isResizingRef(ref.id)}
              onContextMenu={e => favoritesEntity.openMenu(e, { kind: 'stale', refId: ref.id })}
              onStartResize={onStartResize}
            >
              <StaleRefCard itemRef={ref} compact={compact} />
            </IndexCardShell>
          )
        }
        const compact = getPreviewLayout(ref).h <= 1
        return (
          <IndexCardShell
            dragging={options?.dragging}
            resizing={isResizingRef(ref.id)}
            onContextMenu={e => favoritesEntity.openMenu(e, { kind: 'asset', refId: ref.id, asset })}
            onStartResize={onStartResize}
          >
            <AssetCard asset={asset} compact={compact} onClick={onOpenAsset} />
          </IndexCardShell>
        )
      }

      return (
        <IndexCardShell
          dragging={options?.dragging}
          resizing={isResizingRef(ref.id)}
          onContextMenu={e => favoritesEntity.openMenu(e, { kind: 'stale', refId: ref.id })}
          onStartResize={onStartResize}
        >
          <StaleRefCard itemRef={ref} compact={getPreviewLayout(ref).h <= 1} />
        </IndexCardShell>
      )
    },
    [
      assetLookup,
      beginResize,
      doc,
      favoritesEntity,
      getPreviewLayout,
      isResizingRef,
      noteIndex,
      onNavigateFolder,
      onOpenAsset,
      onOpenNote,
    ],
  )

  return (
    <Box sx={{ px: 1.5, py: 1.5 }}>
      <IndexPageToolbar
        breadcrumb={breadcrumbItems}
        canGoBack={canGoBack}
        currentTitle={currentTitle}
        refsCount={refs.length}
        currentFolderId={currentFolderId}
        onGoBack={handleGoBack}
        onNavigateFolder={onNavigateFolder}
        onOpenAddExistingMenu={openAddExistingMenu}
        onOpenCreateNewMenu={openCreateNewMenu}
        onDeleteCurrentFolder={openDeleteCurrentFolderConfirm}
      />

      <Box onContextMenu={e => openContextMenu(e, buildVoidMenuEntries())} sx={{ minHeight: 0 }}>
        {refs.length === 0 ? (
          <Box sx={{ px: 1, py: 4, borderRadius: 4, bgcolor: 'rgba(0,0,0,.02)', textAlign: 'center' }}>
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'rgba(0,0,0,.70)' }}>这个收藏夹还是空的</Typography>
            <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.45)', pt: 0.75 }}>点击右上角添加卡片</Typography>
          </Box>
        ) : (
          <MuuriGrid
            refs={refs}
            gridRef={gridRef}
            getLayout={getPreviewLayout}
            draggingRefId={draggingRefId}
            dropIndicatorLayout={dropIndicatorLayout}
            onPreviewDragLayout={previewDragLayout}
            onCommitDrag={commitDragPreview}
            onCancelPreview={cancelDragPreview}
            onDragStateChange={handleDragStateChange}
            renderItem={(ref, isDragging) => renderRef(ref, { dragging: isDragging })}
          />
        )}
      </Box>

      <ContextMenu
        open={!!contextMenu}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenu?.entries ?? []}
        onClose={closeContextMenu}
      />

      <IndexPageAddMenus
        addExistingAnchorEl={addExistingAnchorEl}
        createNewAnchorEl={createNewAnchorEl}
        onClose={closeAddMenus}
        onAddExistingFolder={() => openAddDialog('existing', 'folder')}
        onAddExistingNote={() => openExistingPicker('note')}
        onAddExistingAsset={() => openExistingPicker('asset')}
        onCreateFolder={() => openAddDialog('create', 'folder')}
        onCreateNote={createNewNote}
        onUploadAsset={uploadNewAssets}
      />

      {favoritesEntity.node}

      {addPickerKind ? (
        <IndexPickerDialog
          open
          kind={addPickerKind}
          gateway={gateway}
          activeRepoId={activeRepoId}
          folderId={currentFolderId}
          doc={doc}
          noteIndex={noteIndex}
          onClose={() => setAddPickerKind(null)}
          onPick={(kind, targetId) => {
            setAddPickerKind(null)
            if (kind === 'note') confirmAddNote(targetId)
            else confirmAddAsset(targetId)
          }}
        />
      ) : null}

      <IndexPageDialogs
        doc={doc}
        currentFolderId={currentFolderId}
        addMode={addMode}
        addKind={addKind}
        folderSuggestions={folderSuggestions}
        folderDisabledReasonById={folderDisabledReasonById}
        deleteFolderConfirmId={deleteFolderConfirmId}
        onCloseAddDialog={closeAddDialog}
        onConfirmAddFolder={confirmAddFolder}
        onAddExistingFolder={addExistingFolder}
        renderFolderSuggestionCard={renderFolderSuggestionCard}
        onCloseDeleteFolder={() => setDeleteFolderConfirmId('')}
        onConfirmDeleteFolder={confirmDeleteCurrentFolder}
      />
    </Box>
  )
}
