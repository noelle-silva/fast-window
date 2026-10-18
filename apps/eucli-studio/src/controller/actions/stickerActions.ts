import { uid } from '../../core/utils'
import { moveListItemById, type ListMovePosition } from '../../domain/listOrdering'
import { validateStickerCategoryName, validateStickerName } from '../../domain/stickerValidator'
import type { AiChatShowToast } from '../../gateway/capabilities'

export function createStickerActions(deps: {
  state: any
  emit: () => void
  showToast?: AiChatShowToast
  pickImageFiles?: (maxCount?: number) => Promise<any[]>
  addStickerInternal: (category: string, name: string, dataUrl: string) => Promise<any>
  createStickerCategoryInternal: (name: string) => Promise<any>
  deleteStickerCategoryInternal: (name: string) => Promise<any>
  deleteStickerInternal: (category: string, name: string) => Promise<any>
  renameStickerInternal: (category: string, oldName: string, nextName: string) => Promise<any>
  reorderStickerCategoriesInternal: (names: string[]) => Promise<any>
  reorderStickersInternal: (category: string, names: string[]) => Promise<any>
  loadStickersFromSource: () => Promise<any>
  setStickersEnabled: (enabled: boolean) => Promise<any>
}) {
  const { state, emit, showToast, pickImageFiles, addStickerInternal, createStickerCategoryInternal, deleteStickerCategoryInternal, deleteStickerInternal, renameStickerInternal, reorderStickerCategoriesInternal, reorderStickersInternal, loadStickersFromSource, setStickersEnabled } = deps

  async function addStickersFromPickedImages(categoryName: any, pickedItems: any) {
    if (!state.data) return
    const list = Array.isArray(pickedItems) ? pickedItems : []
    if (!list.length) return

    const vCat = validateStickerCategoryName(categoryName)
    if (!vCat.ok) return showToast?.(vCat.error || '分类名无效', { kind: 'error' })
    const cat = vCat.name

    let ok = 0
    let dup = 0
    let bad = 0
    let firstError = ''

    for (const it of list) {
      const fn = String(it?.name || '').trim()
      const base = fn ? fn.replace(/\.[a-zA-Z0-9]+$/, '').trim() : ''
      const vName = validateStickerName(base || `表情_${uid('n')}`)
      const name = vName.ok ? vName.name : `表情_${uid('n')}`
      const dataUrl = String(it?.dataUrl || '')
      try {
        const r = await addStickerInternal(cat, name, dataUrl).catch((e: any) => ({ ok: false, kind: 'err' as const, error: e }))
        if (r && (r as any).ok) ok++
        else if ((r as any)?.kind === 'dup') dup++
        else {
          bad++
          if (!firstError) {
            if ((r as any)?.kind === 'bad-image') firstError = '图片格式不支持（仅支持 png/jpg/webp/gif）'
            else firstError = String((r as any)?.error?.message || (r as any)?.error || '导入失败')
          }
        }
      } catch (e: any) {
        bad++
        if (!firstError) firstError = String(e?.message || e || '导入失败')
      }
    }

    if (ok) {
      await loadStickersFromSource()
      emit()
    }
    if (dup) showToast?.(`跳过重名：${dup} 个`, { kind: 'error' })
    if (!ok && bad) showToast?.(firstError || '导入失败', { kind: 'error' })
  }

  async function pickStickerImages(categoryName: any) {
    if (typeof pickImageFiles !== 'function') return showToast?.('未授权：files.pickImages', { kind: 'error' })
    try {
      const items = await pickImageFiles(30)
      await addStickersFromPickedImages(categoryName, items)
    } catch (e) {
      showToast?.(String((e as any)?.message || e || '选择图片失败'), { kind: 'error' })
    }
  }

  return {
    toggleStickersEnabled: () => {
      if (!state.data) return
      if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') state.data.settings.stickers = { enabled: false, categories: [], map: {} }
      const next = !state.data.settings.stickers.enabled
      setStickersEnabled(next)
        .then(() => emit())
        .catch((e: any) => showToast?.(String(e?.message || e || '保存表情包开关失败'), { kind: 'error' }))
    },
    moveStickerCategory: async (categoryName: any, targetCategoryName: any, positionRaw: any) => {
      if (!state.data?.settings?.stickers) return
      const categories: string[] = Array.isArray(state.data.settings.stickers.categories) ? state.data.settings.stickers.categories.map((item: any) => String(item || '')).filter(Boolean) : []
      const name = String(categoryName || '').trim()
      const target = String(targetCategoryName || '').trim()
      const position: ListMovePosition = String(positionRaw || '').trim() === 'after' ? 'after' : 'before'
      if (!name || !target || name === target) return
      const next = moveListItemById(categories, (item) => item, name, target, position)
      if (next === categories) return
      try {
        await reorderStickerCategoriesInternal(next)
        emit()
      } catch (e: any) {
        showToast?.(String(e?.message || e || '表情包分类排序保存失败'), { kind: 'error' })
      }
    },
    moveSticker: async (categoryName: any, stickerName: any, targetStickerName: any, positionRaw: any) => {
      const stickers = state.data?.settings?.stickers
      const category = String(categoryName || '').trim()
      const name = String(stickerName || '').trim()
      const target = String(targetStickerName || '').trim()
      const position: ListMovePosition = String(positionRaw || '').trim() === 'after' ? 'after' : 'before'
      if (!stickers || !category || !name || !target || name === target) return
      const box = stickers.map?.[category]
      if (!box || typeof box !== 'object') return
      const names = Object.keys(box).sort((left, right) => Number((box as any)[left]?.order || 0) - Number((box as any)[right]?.order || 0))
      const next = moveListItemById(names, (item) => item, name, target, position)
      if (next === names) return
      try {
        await reorderStickersInternal(category, next)
        emit()
      } catch (e: any) {
        showToast?.(String(e?.message || e || '表情包排序保存失败'), { kind: 'error' })
      }
    },
    createStickerCategory: async (categoryName: any) => {
      if (!state.data) return
      const v = validateStickerCategoryName(categoryName)
      if (!v.ok) return showToast?.(v.error || '分类名无效', { kind: 'error' })

      const name = v.name
      try {
        await createStickerCategoryInternal(name)
        emit()
        return true
      } catch (e: any) {
        showToast?.(String(e?.message || e || '创建分类失败'), { kind: 'error' })
        return false
      }
    },
    deleteStickerCategory: async (categoryName: any) => {
      if (!state.data) return
      const name = String(categoryName || '').trim()
      if (!name) return
      try {
        await deleteStickerCategoryInternal(name)
        emit()
        return true
      } catch (e: any) {
        showToast?.(String(e?.message || e || '删除分类失败'), { kind: 'error' })
        return false
      }
    },
    addSticker: async (categoryName: any, stickerName: any, dataUrl: any) => {
      if (!state.data) return
      if (!state.data.settings.stickers || typeof state.data.settings.stickers !== 'object') state.data.settings.stickers = { enabled: false, categories: [], map: {} }

      const vCat = validateStickerCategoryName(categoryName)
      if (!vCat.ok) return showToast?.(vCat.error || '分类名无效', { kind: 'error' })
      const cat = vCat.name

      const vName = validateStickerName(stickerName)
      if (!vName.ok) return showToast?.(vName.error || '表情名无效', { kind: 'error' })
      const name = vName.name

      const r = await addStickerInternal(cat, name, dataUrl).catch((e: any) => ({ ok: false, kind: 'err' as const, error: e }))
      if (!r || !r.ok) {
        if (r?.kind === 'dup') return showToast?.('重名：该分类下已存在同名表情', { kind: 'error' })
        if (r?.kind === 'bad-image') return showToast?.('图片格式不支持（仅支持 png/jpg/webp/gif）', { kind: 'error' })
        return showToast?.(String((r as any)?.error?.message || (r as any)?.error || '保存失败'), { kind: 'error' })
      }

      await loadStickersFromSource().catch(() => {})
      emit()
    },
    pickStickerImages: (categoryName: any) => pickStickerImages(categoryName),
    deleteSticker: async (categoryName: any, stickerName: any) => {
      if (!state.data) return
      const cat = String(categoryName || '').trim()
      const name = String(stickerName || '').trim()
      if (!cat || !name) return
      try {
        await deleteStickerInternal(cat, name)
        emit()
      } catch (e: any) {
        showToast?.(String(e?.message || e || '删除表情包失败'), { kind: 'error' })
      }
    },
    renameSticker: async (categoryName: any, oldStickerName: any, newStickerName: any) => {
      if (!state.data) return

      const vCat = validateStickerCategoryName(categoryName)
      if (!vCat.ok) return showToast?.(vCat.error || '分类名无效', { kind: 'error' })
      const cat = vCat.name

      const oldName = String(oldStickerName || '').trim()
      if (!oldName) return

      const vName = validateStickerName(newStickerName)
      if (!vName.ok) return showToast?.(vName.error || '表情名无效', { kind: 'error' })
      const name = vName.name

      if (name === oldName) return showToast?.('名称未变化')
      try {
        await renameStickerInternal(cat, oldName, name)
        emit()
        return true
      } catch (e: any) {
        showToast?.(String(e?.message || e || '表情包改名失败'), { kind: 'error' })
        return false
      }
    },
  }
}
