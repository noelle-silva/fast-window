import * as React from 'react'
import { Box, Menu, MenuItem, Typography } from '@mui/material'

import type { AssetEntry } from '../assetTypes'
import type { Api, NoteMeta, VaultScope } from '../core'
import {
  addRef,
  createFolder,
  deleteFolder,
  getFolderById,
  getRefsByFolderId,
  removeRef,
  type FavoriteFolder,
  type FavoriteItemRef,
  type HyperCortexFavoritesDocV1,
} from '../favorites'
import { getFolderRefIssue } from '../favoritesGraph'
import { AssetCard } from './index-cards/AssetCard'
import { FolderCard } from './index-cards/FolderCard'
import { NoteCard } from './index-cards/NoteCard'
import { StaleRefCard } from './index-cards/StaleRefCard'
import { IndexCardShell } from './index-page/IndexCardShell'
import { INDEX_GRID_COLUMNS, INDEX_GRID_GAP_PX, INDEX_GRID_ROW_PX } from './index-page/constants'
import { folderTitle, getRefGridSpan } from './index-page/helpers'
import { IndexPageDialogs } from './index-page/IndexPageDialogs'
import { SortableItem, SortableRoot, SortableSection } from './index-page/SortableDnd'
import { IndexPageToolbar } from './index-page/IndexPageToolbar'
import type { AddKind, DeleteEntityTarget } from './index-page/types'
import { useIndexLayoutEditor } from './index-page/useIndexLayoutEditor'

type Props = {
  api: Api
  scope: VaultScope
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  editMode: boolean
  noteIndex?: Record<string, NoteMeta>
  assetIndex?: Record<string, any>
  onNavigateFolder: (folderId: string) => void
  onOpenNote: (note: NoteMeta) => void
  onOpenAsset: (asset: AssetEntry) => void
  onDocChange: (doc: HyperCortexFavoritesDocV1) => void
  onEditModeChange: (editMode: boolean) => void
  onDeleteFolderEntity?: (folderId: string) => void
  onDeleteNoteEntity?: (note: NoteMeta) => void
  onDeleteAssetEntity?: (asset: AssetEntry) => void
}

function buildAssetLookup(assetIndex?: Record<string, any>): {
  byKey: Record<string, AssetEntry>
  byAssetId: Record<string, AssetEntry>
} {
  const byKey: Record<string, AssetEntry> = {}
  const byAssetId: Record<string, AssetEntry> = {}
  if (!assetIndex) return { byKey, byAssetId }

  for (const [k, v] of Object.entries(assetIndex)) {
    const asset = v as AssetEntry
    if (!asset || typeof asset !== 'object') continue
    if (typeof (asset as any).relPath !== 'string') continue
    if (typeof (asset as any).assetId !== 'string') continue
    if (typeof (asset as any).ext !== 'string') continue
    byKey[String(k)] = asset
    byAssetId[String(asset.assetId)] = asset
    const key2 = asset.ext ? `${asset.assetId}.${asset.ext}` : asset.assetId
    byKey[key2] = asset
  }
  return { byKey, byAssetId }
}

export function IndexPage(props: Props): React.ReactNode {
  const {
    api,
    doc,
    currentFolderId,
    editMode,
    noteIndex,
    assetIndex,
    onNavigateFolder,
    onOpenNote,
    onOpenAsset,
    onDocChange,
    onEditModeChange,
    onDeleteFolderEntity,
    onDeleteNoteEntity,
    onDeleteAssetEntity,
  } = props

  const [breadcrumb, setBreadcrumb] = React.useState<string[]>(['root'])
  const [addAnchorEl, setAddAnchorEl] = React.useState<HTMLElement | null>(null)
  const [addKind, setAddKind] = React.useState<AddKind | null>(null)
  const [folderTitleDraft, setFolderTitleDraft] = React.useState('')
  const [noteIdDraft, setNoteIdDraft] = React.useState('')
  const [assetIdDraft, setAssetIdDraft] = React.useState('')
  const [noteSearch, setNoteSearch] = React.useState('')
  const [assetSearch, setAssetSearch] = React.useState('')
  const [deleteFolderConfirmId, setDeleteFolderConfirmId] = React.useState('')
  const [deleteEntityTarget, setDeleteEntityTarget] = React.useState<DeleteEntityTarget | null>(null)

  const refs = React.useMemo(() => getRefsByFolderId(doc, currentFolderId), [doc, currentFolderId])
  const currentTitle = React.useMemo(() => folderTitle(doc, currentFolderId), [doc, currentFolderId])
  const assetLookup = React.useMemo(() => buildAssetLookup(assetIndex), [assetIndex])
  const canGoBack = breadcrumb.length > 1

  const { gridRef, sortableIds, draggingRefId, getPreviewLayout, beginResize, handleSortMove, handleSortPreview, handleDragStateChange, isResizingRef } = useIndexLayoutEditor({
    refs,
    doc,
    currentFolderId,
    editMode,
    onDocChange,
  })

  React.useEffect(() => {
    const nextId = String(currentFolderId || '').trim() || 'root'
    setBreadcrumb(prev => {
      const base = prev?.length ? prev : ['root']
      if (nextId === 'root') return ['root']
      if (base[base.length - 1] === nextId) return base
      const existingIdx = base.indexOf(nextId)
      if (existingIdx >= 0) return base.slice(0, existingIdx + 1)
      if (base[0] !== 'root') return ['root', ...base, nextId]
      return [...base, nextId]
    })
  }, [currentFolderId])

  const closeAddMenu = () => setAddAnchorEl(null)
  const openAddMenu = (el: HTMLElement) => setAddAnchorEl(el)

  const openAddDialog = (kind: AddKind) => {
    closeAddMenu()
    setAddKind(kind)
    setFolderTitleDraft('')
    setNoteIdDraft('')
    setAssetIdDraft('')
    setNoteSearch('')
    setAssetSearch('')
  }

  const closeAddDialog = () => setAddKind(null)

  const removeOneRef = React.useCallback(
    (refId: string) => {
      const next = removeRef(doc, refId)
      if (next !== doc) onDocChange(next)
    },
    [doc, onDocChange],
  )

  const confirmAddFolder = React.useCallback(() => {
    const created = createFolder(doc, folderTitleDraft)
    const added = addRef(created.doc, currentFolderId, 'folder', created.folder.id)
    onDocChange(added?.doc || created.doc)
    closeAddDialog()
  }, [currentFolderId, doc, folderTitleDraft, onDocChange])

  const addExistingFolder = React.useCallback(
    (folderId: string) => {
      const issue = getFolderRefIssue(doc, currentFolderId, folderId)
      if (issue === 'self-reference') {
        void api.ui.showToast('不能把当前收藏夹再次引用到自己页面里')
        return
      }
      if (issue === 'cycle') {
        void api.ui.showToast('这次添加会形成收藏夹循环引用，已阻止')
        return
      }
      const added = addRef(doc, currentFolderId, 'folder', folderId)
      if (!added) {
        void api.ui.showToast('这个收藏夹已经在当前页面里了，或无法添加')
        return
      }
      onDocChange(added.doc)
      closeAddDialog()
    },
    [api.ui, currentFolderId, doc, onDocChange],
  )

  const confirmAddNote = React.useCallback(
    (id?: string) => {
      const targetId = String(id ?? noteIdDraft ?? '').trim()
      if (!targetId) return
      const added = addRef(doc, currentFolderId, 'note', targetId)
      if (!added) {
        void api.ui.showToast('这条笔记已经在当前页面里了，或无法添加')
        return
      }
      onDocChange(added.doc)
      closeAddDialog()
    },
    [api.ui, currentFolderId, doc, noteIdDraft, onDocChange],
  )

  const confirmAddAsset = React.useCallback(
    (id?: string) => {
      const targetId = String(id ?? assetIdDraft ?? '').trim()
      if (!targetId) return
      const added = addRef(doc, currentFolderId, 'asset', targetId)
      if (!added) {
        void api.ui.showToast('这个附件已经在当前页面里了，或无法添加')
        return
      }
      onDocChange(added.doc)
      closeAddDialog()
    },
    [api.ui, assetIdDraft, currentFolderId, doc, onDocChange],
  )

  const folderSuggestions = React.useMemo(() => {
    const all = Object.values(doc.folders || {})
      .filter(f => f && f.id && f.id !== 'root' && f.id !== currentFolderId)
      .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
    return all.slice(0, 12)
  }, [doc, currentFolderId])

  const folderDisabledReasonById = React.useMemo(() => {
    const out: Record<string, string> = {}
    for (const folder of folderSuggestions) {
      const issue = getFolderRefIssue(doc, currentFolderId, folder.id)
      if (issue === 'cycle') out[folder.id] = '会形成循环引用，不能添加'
      else if (issue === 'self-reference') out[folder.id] = '不能引用自己'
    }
    return out
  }, [currentFolderId, doc, folderSuggestions])

  const noteSuggestions = React.useMemo(() => {
    if (!noteIndex) return []
    const q = String(noteSearch || '').trim().toLowerCase()
    const all = Object.values(noteIndex || {}).sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
    const filtered = q ? all.filter(n => String(n.title || '').toLowerCase().includes(q) || String(n.id || '').toLowerCase().includes(q)) : all
    return filtered.slice(0, 20)
  }, [noteIndex, noteSearch])

  const assetSuggestions = React.useMemo(() => {
    const values = Object.values(assetLookup.byKey || {})
    const uniq: AssetEntry[] = []
    const seen = new Set<string>()
    for (const a of values) {
      const key = a.ext ? `${a.assetId}.${a.ext}` : a.assetId
      if (seen.has(key)) continue
      seen.add(key)
      uniq.push(a)
    }
    uniq.sort((a, b) => (b.modifiedMs || 0) - (a.modifiedMs || 0))
    const q = String(assetSearch || '').trim().toLowerCase()
    const filtered = q
      ? uniq.filter(a => {
          const key = `${a.assetId}.${a.ext}`.toLowerCase()
          const name = String(a.displayName || a.fileName || '').toLowerCase()
          return key.includes(q) || name.includes(q)
        })
      : uniq
    return filtered.slice(0, 20)
  }, [assetLookup, assetSearch])

  const handleGoBack = React.useCallback(() => {
    if (!canGoBack) {
      void api.ui.showToast('没有上一层索引路径了')
      return
    }
    const prevId = breadcrumb[breadcrumb.length - 2] || 'root'
    onNavigateFolder(prevId)
  }, [api.ui, breadcrumb, canGoBack, onNavigateFolder])

  const openDeleteCurrentFolderConfirm = React.useCallback(() => {
    if (currentFolderId === 'root') {
      void api.ui.showToast('根收藏夹不能删除')
      return
    }
    setDeleteFolderConfirmId(currentFolderId)
  }, [api.ui, currentFolderId])

  const confirmDeleteCurrentFolder = React.useCallback(() => {
    const targetId = String(deleteFolderConfirmId || '').trim()
    if (!targetId) return
    const nextDoc = deleteFolder(doc, targetId)
    if (!nextDoc) {
      void api.ui.showToast('删除收藏夹失败')
      return
    }
    onDocChange(nextDoc)
    setDeleteFolderConfirmId('')
    onNavigateFolder('root')
    onDeleteFolderEntity?.(targetId)
  }, [api.ui, deleteFolderConfirmId, doc, onDeleteFolderEntity, onDocChange, onNavigateFolder])

  const confirmDeleteEntity = React.useCallback(() => {
    const target = deleteEntityTarget
    if (!target) return
    setDeleteEntityTarget(null)
    if (target.kind === 'folder') {
      const nextDoc = deleteFolder(doc, target.folderId)
      if (!nextDoc) {
        void api.ui.showToast('删除收藏夹失败')
        return
      }
      onDocChange(nextDoc)
      onDeleteFolderEntity?.(target.folderId)
      if (target.folderId === currentFolderId) onNavigateFolder('root')
      return
    }
    if (target.kind === 'note') {
      onDeleteNoteEntity?.(target.note)
      return
    }
    onDeleteAssetEntity?.(target.asset)
  }, [api.ui, currentFolderId, deleteEntityTarget, doc, onDeleteAssetEntity, onDeleteFolderEntity, onDeleteNoteEntity, onDocChange, onNavigateFolder])

  const breadcrumbItems = React.useMemo(
    () => breadcrumb.map(id => ({ id, title: folderTitle(doc, id) })),
    [breadcrumb, doc],
  )

  const renderFolderSuggestionCard = React.useCallback(
    (folder: FavoriteFolder) => {
      const refCount = getRefsByFolderId(doc, folder.id).length
      return <FolderCard folderId={folder.id} title={folder.title} refCount={refCount} updatedAtMs={folder.updatedAtMs} disabled onClick={() => {}} />
    },
    [doc],
  )

  const renderRef = React.useCallback(
    (
      ref: FavoriteItemRef,
      sortable?: { setDragHandleRef: (node: HTMLElement | null) => void; dragHandleProps: Record<string, any>; dragging: boolean },
    ): React.ReactNode => {
      const onStartResize = editMode ? (e: React.PointerEvent) => beginResize(ref, e) : undefined

      if (ref.kind === 'folder') {
        const folder = getFolderById(doc, ref.targetId)
        if (!folder) {
          return (
            <IndexCardShell
              editMode={editMode}
              dragging={sortable?.dragging}
              resizing={isResizingRef(ref.id)}
              dragHandleProps={sortable?.dragHandleProps}
              setDragHandleRef={sortable?.setDragHandleRef}
              onRemove={() => removeOneRef(ref.id)}
              onStartResize={onStartResize}
            >
              <StaleRefCard ref={ref} disabled={editMode} onClickRemove={removeOneRef} />
            </IndexCardShell>
          )
        }
        const refCount = getRefsByFolderId(doc, folder.id).length
        return (
          <IndexCardShell
            editMode={editMode}
            dragging={sortable?.dragging}
            resizing={isResizingRef(ref.id)}
            dragHandleProps={sortable?.dragHandleProps}
            setDragHandleRef={sortable?.setDragHandleRef}
            onRemove={() => removeOneRef(ref.id)}
            onDeleteEntity={() => setDeleteEntityTarget({ kind: 'folder', title: folder.title || '未命名收藏夹', folderId: folder.id })}
            onStartResize={onStartResize}
          >
            <FolderCard folderId={folder.id} title={folder.title} refCount={refCount} updatedAtMs={folder.updatedAtMs} disabled={editMode} onClick={fid => onNavigateFolder(fid)} />
          </IndexCardShell>
        )
      }

      if (ref.kind === 'note') {
        const note = noteIndex?.[ref.targetId]
        if (!note) {
          return (
            <IndexCardShell
              editMode={editMode}
              dragging={sortable?.dragging}
              resizing={isResizingRef(ref.id)}
              dragHandleProps={sortable?.dragHandleProps}
              setDragHandleRef={sortable?.setDragHandleRef}
              onRemove={() => removeOneRef(ref.id)}
              onStartResize={onStartResize}
            >
              <StaleRefCard ref={ref} disabled={editMode} onClickRemove={removeOneRef} />
            </IndexCardShell>
          )
        }
        return (
          <IndexCardShell
            editMode={editMode}
            dragging={sortable?.dragging}
            resizing={isResizingRef(ref.id)}
            dragHandleProps={sortable?.dragHandleProps}
            setDragHandleRef={sortable?.setDragHandleRef}
            onRemove={() => removeOneRef(ref.id)}
            onDeleteEntity={() => setDeleteEntityTarget({ kind: 'note', title: note.title || '未命名笔记', note })}
            onStartResize={onStartResize}
          >
            <NoteCard note={note} disabled={editMode} onClick={onOpenNote} />
          </IndexCardShell>
        )
      }

      if (ref.kind === 'asset') {
        const asset = assetLookup.byKey[ref.targetId] || assetLookup.byAssetId[ref.targetId]
        if (!asset) {
          return (
            <IndexCardShell
              editMode={editMode}
              dragging={sortable?.dragging}
              resizing={isResizingRef(ref.id)}
              dragHandleProps={sortable?.dragHandleProps}
              setDragHandleRef={sortable?.setDragHandleRef}
              onRemove={() => removeOneRef(ref.id)}
              onStartResize={onStartResize}
            >
              <StaleRefCard ref={ref} disabled={editMode} onClickRemove={removeOneRef} />
            </IndexCardShell>
          )
        }
        return (
          <IndexCardShell
            editMode={editMode}
            dragging={sortable?.dragging}
            resizing={isResizingRef(ref.id)}
            dragHandleProps={sortable?.dragHandleProps}
            setDragHandleRef={sortable?.setDragHandleRef}
            onRemove={() => removeOneRef(ref.id)}
            onDeleteEntity={() => setDeleteEntityTarget({ kind: 'asset', title: String(asset.displayName || asset.fileName || asset.assetId), asset })}
            onStartResize={onStartResize}
          >
            <AssetCard asset={asset} disabled={editMode} onClick={onOpenAsset} />
          </IndexCardShell>
        )
      }

      return (
        <IndexCardShell
          editMode={editMode}
          dragging={sortable?.dragging}
          resizing={isResizingRef(ref.id)}
          dragHandleProps={sortable?.dragHandleProps}
          setDragHandleRef={sortable?.setDragHandleRef}
          onRemove={() => removeOneRef(ref.id)}
          onStartResize={onStartResize}
        >
          <StaleRefCard ref={ref} disabled={editMode} onClickRemove={removeOneRef} />
        </IndexCardShell>
      )
    },
    [
      assetLookup.byAssetId,
      assetLookup.byKey,
      beginResize,
      doc,
      editMode,
      getPreviewLayout,
      isResizingRef,
      noteIndex,
      onNavigateFolder,
      onOpenAsset,
      onOpenNote,
      removeOneRef,
    ],
  )

  const renderDragOverlay = React.useCallback(
    (activeId: string, rect: { width: number; height: number } | null): React.ReactNode => {
      const activeRef = refs.find(ref => ref.id === activeId)
      if (!activeRef) return null
      return (
        <Box
          sx={{
            width: rect?.width || 240,
            height: rect?.height || 'auto',
            minHeight: rect?.height || undefined,
            pointerEvents: 'none',
          }}
        >
          {renderRef(activeRef, { setDragHandleRef: () => {}, dragHandleProps: {}, dragging: true })}
        </Box>
      )
    },
    [refs, renderRef],
  )

  return (
    <Box sx={{ px: 1.5, py: 1.5 }}>
      <IndexPageToolbar
        breadcrumb={breadcrumbItems}
        canGoBack={canGoBack}
        currentTitle={currentTitle}
        refsCount={refs.length}
        editMode={editMode}
        currentFolderId={currentFolderId}
        onGoBack={handleGoBack}
        onNavigateFolder={onNavigateFolder}
        onOpenAddMenu={openAddMenu}
        onToggleEditMode={() => onEditModeChange(!editMode)}
        onDeleteCurrentFolder={openDeleteCurrentFolderConfirm}
      />

      {refs.length === 0 ? (
        <Box sx={{ px: 1, py: 4, borderRadius: 4, bgcolor: 'rgba(0,0,0,.02)', textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: 'rgba(0,0,0,.70)' }}>这个收藏夹还是空的</Typography>
          {editMode ? <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.45)', pt: 0.75 }}>点击右上角添加卡片</Typography> : null}
        </Box>
      ) : (
        <SortableRoot onMove={handleSortMove} onPreviewMove={handleSortPreview} onDragStateChange={handleDragStateChange} renderOverlay={renderDragOverlay}>
          <SortableSection items={sortableIds}>
            <Box
              ref={gridRef}
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${INDEX_GRID_COLUMNS}, minmax(0, 1fr))`,
                gridAutoRows: `${INDEX_GRID_ROW_PX}px`,
                gap: `${INDEX_GRID_GAP_PX}px`,
              }}
            >
              {refs.map(ref => {
                const layoutRef = draggingRefId === ref.id ? ref : { ...ref, layout: getPreviewLayout(ref) }
                return (
                  <SortableItem key={ref.id} id={ref.id} disabled={!editMode}>
                    {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
                      <Box
                        ref={setNodeRef}
                        style={
                          isDragging
                            ? { ...style, transform: undefined, transition: undefined, opacity: 0, pointerEvents: 'none' }
                            : style
                        }
                        sx={{ ...getRefGridSpan(layoutRef), minWidth: 0, height: '100%', minHeight: 0 }}
                      >
                        {renderRef(ref, { setDragHandleRef: setHandleRef, dragHandleProps: handleProps, dragging: isDragging })}
                      </Box>
                    )}
                  </SortableItem>
                )
              })}
            </Box>
          </SortableSection>
        </SortableRoot>
      )}

      <Menu open={!!addAnchorEl} onClose={closeAddMenu} anchorEl={addAnchorEl} PaperProps={{ sx: { borderRadius: 7, overflow: 'hidden' } }}>
        <MenuItem onClick={() => openAddDialog('folder')}>收藏夹</MenuItem>
        <MenuItem onClick={() => openAddDialog('note')}>笔记</MenuItem>
        <MenuItem onClick={() => openAddDialog('asset')}>附件</MenuItem>
      </Menu>

      <IndexPageDialogs
        doc={doc}
        currentFolderId={currentFolderId}
        addKind={addKind}
        folderTitleDraft={folderTitleDraft}
        noteIdDraft={noteIdDraft}
        assetIdDraft={assetIdDraft}
        noteSearch={noteSearch}
        assetSearch={assetSearch}
        noteIndex={noteIndex}
        folderSuggestions={folderSuggestions}
        folderDisabledReasonById={folderDisabledReasonById}
        noteSuggestions={noteSuggestions}
        assetSuggestions={assetSuggestions}
        assetLookupKeyCount={Object.keys(assetLookup.byKey).length}
        deleteFolderConfirmId={deleteFolderConfirmId}
        deleteEntityTarget={deleteEntityTarget}
        onCloseAddDialog={closeAddDialog}
        onFolderTitleDraftChange={setFolderTitleDraft}
        onNoteIdDraftChange={setNoteIdDraft}
        onAssetIdDraftChange={setAssetIdDraft}
        onNoteSearchChange={setNoteSearch}
        onAssetSearchChange={setAssetSearch}
        onConfirmAddFolder={confirmAddFolder}
        onAddExistingFolder={addExistingFolder}
        onConfirmAddNote={confirmAddNote}
        onConfirmAddAsset={confirmAddAsset}
        renderFolderSuggestionCard={renderFolderSuggestionCard}
        onCloseDeleteFolder={() => setDeleteFolderConfirmId('')}
        onConfirmDeleteFolder={confirmDeleteCurrentFolder}
        onCloseDeleteEntity={() => setDeleteEntityTarget(null)}
        onConfirmDeleteEntity={confirmDeleteEntity}
      />
    </Box>
  )
}
