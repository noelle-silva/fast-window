import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded'

import type { AssetEntry } from '../../assetTypes'
import type { NoteMeta } from '../../core'
import {
  addRef,
  createFolder,
  deleteFolder,
  getRefsByFolderId,
  type FavoriteItemRef,
  type HyperCortexFavoritesDocV1,
} from '../../favorites'
import { getFolderRefIssue } from '../../favoritesGraph'
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
  onCreateNoteInIndex?: (folderId: string) => Promise<void> | void
  onUploadAssetsInIndex?: (folderId: string) => Promise<void> | void
  onDeleteFolderEntity?: (folderId: string) => void
  onDeleteNoteEntity?: (note: NoteMeta) => void
  onDeleteAssetEntity?: (asset: AssetEntry) => void
  onUpdateNoteInfo?: (note: NoteMeta, patch: { title: string; description: string }) => Promise<void> | void
  onUpdateAssetInfo?: (asset: AssetEntry, patch: { displayName: string; remark: string }) => Promise<void> | void
}

export function useIndexPageActions(opts: Options) {
  const {
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
  } = opts

  const [breadcrumb, setBreadcrumb] = React.useState<string[]>(['root'])
  const [addExistingAnchorEl, setAddExistingAnchorEl] = React.useState<HTMLElement | null>(null)
  const [createNewAnchorEl, setCreateNewAnchorEl] = React.useState<HTMLElement | null>(null)
  const [addMode, setAddMode] = React.useState<AddMode | null>(null)
  const [addKind, setAddKind] = React.useState<AddKind | null>(null)
  const [addPickerKind, setAddPickerKind] = React.useState<'note' | 'asset' | null>(null)
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

  const openExistingPicker = React.useCallback((kind: 'note' | 'asset') => {
    closeAddMenus()
    setAddPickerKind(kind)
  }, [])

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

  const addExistingFolder = React.useCallback(
    (folderId: string) => {
      const issue = getFolderRefIssue(doc, currentFolderId, folderId)
      if (issue === 'self-reference') {
        void gateway.host.toast('不能把当前收藏夹再次引用到自己页面里')
        return
      }
      if (issue === 'cycle') {
        void gateway.host.toast('这次添加会形成收藏夹循环引用，已阻止')
        return
      }
      const added = addRef(doc, currentFolderId, 'folder', folderId)
      if (!added) {
        void gateway.host.toast('这个收藏夹已经在当前页面里了，或无法添加')
        return
      }
      onDocChange(added.doc)
      closeAddDialog()
    },
    [currentFolderId, doc, gateway, onDocChange],
  )

  const confirmAddNote = React.useCallback(
    (id: string) => {
      const targetId = String(id || '').trim()
      if (!targetId) return
      const added = addRef(doc, currentFolderId, 'note', targetId)
      if (!added) {
        void gateway.host.toast('这条笔记已经在当前页面里了，或无法添加')
        return
      }
      onDocChange(added.doc)
    },
    [currentFolderId, doc, gateway, onDocChange],
  )

  const confirmAddAsset = React.useCallback(
    (id: string) => {
      const targetId = String(id || '').trim()
      if (!targetId) return
      const added = addRef(doc, currentFolderId, 'asset', targetId)
      if (!added) {
        void gateway.host.toast('这个附件已经在当前页面里了，或无法添加')
        return
      }
      onDocChange(added.doc)
    },
    [currentFolderId, doc, gateway, onDocChange],
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
    const nextDoc = deleteFolder(doc, targetId)
    if (!nextDoc) {
      void gateway.host.toast('删除收藏夹失败')
      return
    }
    onDocChange(nextDoc)
    setDeleteFolderConfirmId('')
    onNavigateFolder('root')
    onDeleteFolderEntity?.(targetId)
  }, [deleteFolderConfirmId, doc, gateway, onDeleteFolderEntity, onDocChange, onNavigateFolder])

  const favoritesEntity = useFavoritesEntityActions({
    doc,
    onDocChange,
    toast: message => void gateway.host.toast(message),
    onUpdateNoteInfo,
    onUpdateAssetInfo,
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
          { id: 'add-folder', label: '已有收藏夹', onSelect: () => openAddDialog('existing', 'folder') },
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
  }
}
