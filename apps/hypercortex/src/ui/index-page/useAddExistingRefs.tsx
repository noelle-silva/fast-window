import * as React from 'react'
import type { NoteMeta } from '../../core'
import { addRef, type HyperCortexFavoritesDocV1 } from '../../favorites'
import { getFolderRefIssue } from '../../favoritesGraph'
import type { HyperCortexGateway } from '../../gateway'
import { AddExistingFolderDialog } from './AddExistingFolderDialog'
import { IndexPickerDialog } from './IndexPickerDialog'
import type { AddKind } from './types'

// 「添加已有」到某一收藏夹页的统一挑选流程：笔记、附件走 IndexPickerDialog，收藏夹走
// AddExistingFolderDialog；自引用、循环引用与重复条目一律由既有 addRef / getFolderRefIssue 判定拦截。
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

  const addExistingFolder = React.useCallback(
    (targetFolderId: string) => {
      const issue = getFolderRefIssue(doc, folderId, targetFolderId)
      if (issue === 'self-reference') {
        void gateway.host.toast('不能把当前收藏夹再次引用到自己页面里')
        return
      }
      if (issue === 'cycle') {
        void gateway.host.toast('这次添加会形成收藏夹循环引用，已阻止')
        return
      }
      const added = addRef(doc, folderId, 'folder', targetFolderId)
      if (!added) {
        void gateway.host.toast('这个收藏夹已经在当前页面里了，或无法添加')
        return
      }
      onDocChange(added.doc)
      setFolderPickerOpen(false)
    },
    [doc, folderId, gateway, onDocChange],
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
      <AddExistingFolderDialog
        open={folderPickerOpen}
        doc={doc}
        currentFolderId={folderId}
        onClose={() => setFolderPickerOpen(false)}
        onAddExistingFolder={addExistingFolder}
      />
    </>
  )

  return { openAddExisting, node }
}
