import * as React from 'react'
import type { NoteMeta } from '../../core'
import { addRef, getRefsByFolderId, removeRef, type HyperCortexFavoritesDocV1 } from '../../favorites'
import type { HyperCortexGateway } from '../../gateway'
import { FavoritesTreePickerDialog, type FavoritesSaveResult } from '../FavoritesTreePickerDialog'
import { IndexPickerDialog } from './IndexPickerDialog'
import type { AddKind } from './types'

// 「添加已有」到某一收藏夹页的统一挑选流程：笔记、附件走 IndexPickerDialog，收藏夹走
// FavoritesTreePickerDialog 的添加模式；重复与循环引用一律由既有 addRef / getFolderRefIssue 判定拦截。
// 索引页与右侧收藏夹栏共用同一份挑选弹窗与判定，不另造第二套。

type Options = {
  gateway: HyperCortexGateway
  activeRepoId: string
  doc: HyperCortexFavoritesDocV1
  /** 目标收藏夹页：选中对象作为引用加入该页。 */
  folderId: string
  noteIndex?: Record<string, NoteMeta>
  onDocChange: (doc: HyperCortexFavoritesDocV1) => void
}

export function useAddExistingRefs(opts: Options): {
  openAddExisting: (kind: AddKind) => void
  node: React.ReactNode
} {
  const { gateway, activeRepoId, doc, folderId, noteIndex, onDocChange } = opts
  const [pickerKind, setPickerKind] = React.useState<'note' | 'asset' | null>(null)
  const [folderPickerOpen, setFolderPickerOpen] = React.useState(false)

  const openAddExisting = React.useCallback((kind: AddKind) => {
    if (kind === 'folder') setFolderPickerOpen(true)
    else setPickerKind(kind)
  }, [])

  const confirmAddNote = React.useCallback(
    (id: string) => {
      const targetId = String(id || '').trim()
      if (!targetId) return
      const added = addRef(doc, folderId, 'note', targetId)
      if (!added) {
        void gateway.host.toast('这条笔记已经在当前页面里了，或无法添加')
        return
      }
      onDocChange(added.doc)
    },
    [doc, folderId, gateway, onDocChange],
  )

  const confirmAddAsset = React.useCallback(
    (id: string) => {
      const targetId = String(id || '').trim()
      if (!targetId) return
      const added = addRef(doc, folderId, 'asset', targetId)
      if (!added) {
        void gateway.host.toast('这个附件已经在当前页面里了，或无法添加')
        return
      }
      onDocChange(added.doc)
    },
    [doc, folderId, gateway, onDocChange],
  )

  // 添加已有收藏夹：把选中的收藏夹作为引用加入当前页；已在当前页的默认勾选，取消勾选即移除该引用。
  const confirmAddFolders = React.useCallback(
    (result: FavoritesSaveResult) => {
      const selected = new Set(result.selectedFolderIds)
      const already = new Set(result.alreadySavedFolderIds)
      let next = doc

      for (const targetId of result.selectedFolderIds) {
        if (already.has(targetId)) continue
        const added = addRef(next, folderId, 'folder', targetId)
        if (added) next = added.doc
      }

      for (const targetId of result.alreadySavedFolderIds) {
        if (selected.has(targetId)) continue
        const existing = getRefsByFolderId(next, folderId).find(ref => ref.kind === 'folder' && ref.targetId === targetId)
        if (!existing) continue
        const afterRemove = removeRef(next, existing.id)
        if (afterRemove !== next) next = afterRemove
      }

      setFolderPickerOpen(false)
      if (next !== doc) onDocChange(next)
    },
    [doc, folderId, onDocChange],
  )

  const node = (
    <>
      {pickerKind ? (
        <IndexPickerDialog
          open
          kind={pickerKind}
          gateway={gateway}
          activeRepoId={activeRepoId}
          folderId={folderId}
          doc={doc}
          noteIndex={noteIndex}
          onClose={() => setPickerKind(null)}
          onPick={(kind, targetId) => {
            setPickerKind(null)
            if (kind === 'note') confirmAddNote(targetId)
            else confirmAddAsset(targetId)
          }}
        />
      ) : null}
      <FavoritesTreePickerDialog
        open={folderPickerOpen}
        mode="add-folder"
        doc={doc}
        containerFolderId={folderId}
        onClose={() => setFolderPickerOpen(false)}
        onSave={confirmAddFolders}
      />
    </>
  )

  return { openAddExisting, node }
}
