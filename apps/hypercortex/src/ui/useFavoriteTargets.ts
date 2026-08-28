import * as React from 'react'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { addRef, getRefsByFolderId, removeRef } from '../favorites'
import type { FavoritesSaveResult } from './FavoritesTreePickerDialog'

export type FavoriteTarget = {
  kind: FavoriteItemRef['kind']
  id: string
}

type Options = {
  doc: HyperCortexFavoritesDocV1 | null | undefined
  onDocChange: (doc: HyperCortexFavoritesDocV1) => void
  toast: (message: string) => void
}

export function useFavoriteTargets(opts: Options) {
  const { doc, onDocChange, toast } = opts
  const [target, setTarget] = React.useState<FavoriteTarget | null>(null)
  const [pickerOpen, setPickerOpen] = React.useState(false)

  const openPicker = React.useCallback(
    (next: FavoriteTarget) => {
      if (!doc) return
      setTarget(next)
      setPickerOpen(true)
    },
    [doc],
  )

  const closePicker = React.useCallback(() => setPickerOpen(false), [])

  const saveResult = React.useCallback(
    (result: FavoritesSaveResult) => {
      const currentTarget = target
      if (!currentTarget || !doc) return
      const selectedSet = new Set(result.selectedFolderIds)
      const alreadySet = new Set(result.alreadySavedFolderIds)
      const toAdd = result.selectedFolderIds.filter(id => !alreadySet.has(id))
      const toRemove = result.alreadySavedFolderIds.filter(id => !selectedSet.has(id))

      let next = doc
      let addedCount = 0
      let removedCount = 0
      let failedCount = 0
      for (const folderId of toAdd) {
        const added = addRef(next, folderId, currentTarget.kind, currentTarget.id)
        if (added) {
          next = added.doc
          addedCount++
        } else {
          failedCount++
        }
      }
      for (const folderId of toRemove) {
        const refs = getRefsByFolderId(next, folderId)
        const existingRef = refs.find(ref => ref.kind === currentTarget.kind && ref.targetId === currentTarget.id)
        if (!existingRef) continue
        const afterRemove = removeRef(next, existingRef.id)
        if (afterRemove !== next) {
          next = afterRemove
          removedCount++
        }
      }

      setPickerOpen(false)
      setTarget(null)
      if (next !== doc) onDocChange(next)

      if (failedCount > 0) {
        toast('部分收藏夹未更新（目标已存在或会形成循环引用）')
      } else if (addedCount > 0 && removedCount === 0) {
        toast('收藏成功')
      } else if (removedCount > 0 && addedCount === 0) {
        toast('已取消收藏')
      } else if (addedCount > 0 || removedCount > 0) {
        toast('收藏状态已更新')
      }
    },
    [doc, onDocChange, target, toast],
  )

  return React.useMemo(
    () => ({ pickerOpen, target, openPicker, closePicker, saveResult }),
    [closePicker, openPicker, pickerOpen, saveResult, target],
  )
}
