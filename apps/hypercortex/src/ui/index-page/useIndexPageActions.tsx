import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'

import type { AssetEntry } from '../../assetTypes'
import type { NoteMeta } from '../../core'
import type { EntityIcon } from '../../entityIcon'
import type { HyperCortexNoteManifestV1 } from '../../noteSchema'
import {
  addRef,
  createFolder,
  getRefsByFolderId,
  type FavoriteItemRef,
  type HyperCortexFavoritesDocV1,
} from '../../favorites'
import type { HyperCortexGateway } from '../../gateway'
import type { ContextMenuAction } from '../ContextMenu'
import { useFavoritesEntityActions } from '../useFavoritesEntityActions'
import { folderTitle } from './helpers'
import type { AddKind, AddMode } from './types'

type CardMenuTarget =
  | { kind: 'folder'; ref: FavoriteItemRef; folderId: string; title: string; description: string }
  | { kind: 'note'; ref: FavoriteItemRef; note: NoteMeta }
  | { kind: 'asset'; ref: FavoriteItemRef; asset: AssetEntry }
  | { kind: 'stale'; ref: FavoriteItemRef }

type VoidMenuEntries = ContextMenuAction[]

type Options = {
  gateway: HyperCortexGateway
  doc: HyperCortexFavoritesDocV1
  currentFolderId: string
  onNavigateFolder: (folderId: string) => void
  onDocChange: (doc: HyperCortexFavoritesDocV1) => void
  /** 「添加已有」挑选入口：由上层注入共享挑选流程（笔记/收藏夹/附件同源）。 */
  onAddExisting: (kind: AddKind) => void
  onCreateNoteInIndex?: (folderId: string) => Promise<void> | void
  onUploadAssetsInIndex?: (folderId: string) => Promise<void> | void
  onDeleteFolderEntity?: (folderId: string) => void
  onDeleteNoteEntity?: (note: NoteMeta, refs?: FavoriteItemRef[]) => Promise<boolean> | boolean
  onDeleteAssetEntity?: (asset: AssetEntry, refs?: FavoriteItemRef[]) => Promise<boolean> | boolean
  onUpdateNoteInfo?: (note: NoteMeta, patch: { title: string; description: string }) => Promise<void> | void
  onUpdateAssetInfo?: (asset: AssetEntry, patch: { displayName: string; remark: string }) => Promise<void> | void
  onUpdateNoteIcon?: (note: NoteMeta, payload: { icon?: EntityIcon; manifest?: HyperCortexNoteManifestV1 }) => void
  onUpdateAssetIcon?: (asset: AssetEntry, icon: EntityIcon | undefined) => void
}

export function useIndexPageActions(opts: Options) {
  const {
    gateway,
    doc,
    currentFolderId,
    onNavigateFolder,
    onDocChange,
    onAddExisting,
    onCreateNoteInIndex,
    onUploadAssetsInIndex,
    onDeleteFolderEntity,
    onDeleteNoteEntity,
    onDeleteAssetEntity,
    onUpdateNoteInfo,
    onUpdateAssetInfo,
    onUpdateNoteIcon,
    onUpdateAssetIcon,
  } = opts

  const [breadcrumb, setBreadcrumb] = React.useState<string[]>(['root'])
  const [addExistingAnchorEl, setAddExistingAnchorEl] = React.useState<HTMLElement | null>(null)
  const [createNewAnchorEl, setCreateNewAnchorEl] = React.useState<HTMLElement | null>(null)
  const [addMode, setAddMode] = React.useState<AddMode | null>(null)
  const [addKind, setAddKind] = React.useState<AddKind | null>(null)
  const [deleteFolderConfirmId, setDeleteFolderConfirmId] = React.useState('')

  const refs = React.useMemo(() => getRefsByFolderId(doc, currentFolderId), [doc, currentFolderId])
  const currentTitle = React.useMemo(() => folderTitle(doc, currentFolderId), [doc, currentFolderId])
  const canGoBack = breadcrumb.length > 1

  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; entries: ContextMenuAction[] } | null>(null)

  const openContextMenu = React.useCallback((e: React.MouseEvent, entries: ContextMenuAction[]) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, entries })
  }, [])

  const closeContextMenu = React.useCallback(() => setContextMenu(null), [])
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

  const closeAddMenus = () => {
    setAddExistingAnchorEl(null)
    setCreateNewAnchorEl(null)
  }
  const openAddExistingMenu = (el: HTMLElement) => setAddExistingAnchorEl(el)
  const openCreateNewMenu = (el: HTMLElement) => setCreateNewAnchorEl(el)

  const openAddDialog = (mode: AddMode, kind: AddKind) => {
    closeAddMenus()
    setAddMode(mode)
    setAddKind(kind)
  }

  const openExistingPicker = React.useCallback((kind: AddKind) => {
    closeAddMenus()
    onAddExisting(kind)
  }, [onAddExisting])

  const closeAddDialog = () => {
    setAddMode(null)
    setAddKind(null)
  }

  const createNewNote = React.useCallback(() => {
    closeAddMenus()
    void onCreateNoteInIndex?.(currentFolderId)
  }, [currentFolderId, onCreateNoteInIndex])

  const uploadNewAssets = React.useCallback(() => {
    closeAddMenus()
    void onUploadAssetsInIndex?.(currentFolderId)
  }, [currentFolderId, onUploadAssetsInIndex])

  const confirmAddFolder = React.useCallback(
    (info: { title: string; description: string }) => {
      const created = createFolder(doc, info.title, info.description)
      const added = addRef(created.doc, currentFolderId, 'folder', created.folder.id)
      onDocChange(added?.doc || created.doc)
      closeAddDialog()
    },
    [currentFolderId, doc, onDocChange],
  )

  const handleGoBack = React.useCallback(() => {
    if (!canGoBack) {
      void gateway.host.toast('没有上一层索引路径了')
      return
    }
    const prevId = breadcrumb[breadcrumb.length - 2] || 'root'
    onNavigateFolder(prevId)
  }, [breadcrumb, canGoBack, gateway, onNavigateFolder])

  const openDeleteCurrentFolderConfirm = React.useCallback(() => {
    if (currentFolderId === 'root') {
      void gateway.host.toast('根收藏夹不能删除')
      return
    }
    setDeleteFolderConfirmId(currentFolderId)
  }, [currentFolderId, gateway])

  const confirmDeleteCurrentFolder = React.useCallback(() => {
    const targetId = String(deleteFolderConfirmId || '').trim()
    if (!targetId) return
    setDeleteFolderConfirmId('')
    // 实体删除统一交给上层入口执行（回收站或永久删除），本层只负责关闭确认与回到根层。
    onDeleteFolderEntity?.(targetId)
    onNavigateFolder('root')
  }, [deleteFolderConfirmId, onDeleteFolderEntity, onNavigateFolder])

  const favoritesEntity = useFavoritesEntityActions({
    doc,
    onDocChange,
    toast: message => void gateway.host.toast(message),
    gateway,
    scope: 'library',
    onUpdateNoteInfo,
    onUpdateAssetInfo,
    onUpdateNoteIcon,
    onUpdateAssetIcon,
    canDeleteRefs: true,
    onDeleteFolderEntity: folderId => {
      onDeleteFolderEntity?.(folderId)
      if (folderId === currentFolderId) onNavigateFolder('root')
    },
    onDeleteNoteEntity,
    onDeleteAssetEntity,
  })

  const buildVoidMenuEntries = React.useCallback((): VoidMenuEntries => {
    return [
      {
        id: 'add',
        label: '添加已有',
        icon: <AddRoundedIcon fontSize="small" />,
        children: [
          { id: 'add-folder', label: '已有收藏夹', onSelect: () => openExistingPicker('folder') },
          { id: 'add-note', label: '已有笔记', onSelect: () => openExistingPicker('note') },
          { id: 'add-asset', label: '已有附件', onSelect: () => openExistingPicker('asset') },
        ],
      },
      {
        id: 'create',
        label: '新建内容',
        icon: <CreateNewFolderRoundedIcon fontSize="small" />,
        children: [
          { id: 'create-folder', label: '新收藏夹', onSelect: () => openAddDialog('create', 'folder') },
          { id: 'create-note', label: '新笔记', onSelect: () => createNewNote() },
          { id: 'create-asset', label: '上传附件', onSelect: () => uploadNewAssets() },
        ],
      },
    ]
  }, [createNewNote, openAddDialog, openExistingPicker, uploadNewAssets])

  const breadcrumbItems = React.useMemo(
    () => breadcrumb.map(id => ({ id, title: folderTitle(doc, id) })),
    [breadcrumb, doc],
  )

  return {
    refs,
    currentTitle,
    canGoBack,
    breadcrumbItems,
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
    deleteFolderConfirmId,
    openAddDialog,
    openExistingPicker,
    closeAddDialog,
    createNewNote,
    uploadNewAssets,
    confirmAddFolder,
    handleGoBack,
    openDeleteCurrentFolderConfirm,
    confirmDeleteCurrentFolder,
    setDeleteFolderConfirmId,
    favoritesEntity,
  }
}
