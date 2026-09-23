import { uid } from '../core/utils'
import { MAX_DRAFT_IMAGES } from '../domain/constants'
import { looksLikeImageDataUrl } from '../domain/textProcessing'
import {
  activeComposerDraftKey,
  activateComposerDraftForCurrentSession,
  readComposerDraftByKey,
  setComposerDraftImagesByKey,
} from '../domain/sessionComposerDrafts'
import type { createChatOperationsShared } from './chatOperationsShared'

export function createChatDraftOperations(shared: ReturnType<typeof createChatOperationsShared>) {
  const { deps } = shared
  const { getState, pickImageFiles, showToast, renderComposer, readImageFileAsDataUrl } = deps

  function addDraftImage(name: any, dataUrl: any, draftKeyRaw?: any) {
    const state = getState()
    if (!looksLikeImageDataUrl(dataUrl)) return false
    const draftKey = String(draftKeyRaw || activeComposerDraftKey(state)).trim()
    if (!draftKey) return false
    if (!draftKeyRaw) activateComposerDraftForCurrentSession(state)
    const draft = readComposerDraftByKey(state, draftKey)
    if (draft.images.length >= MAX_DRAFT_IMAGES) return false
    setComposerDraftImagesByKey(state, draftKey, draft.images.concat({ id: uid('img'), name: String(name || '图片'), dataUrl: String(dataUrl || '') }))
    return true
  }

  async function pickDraftImages() {
    const state = getState()
    if (state.loading) return
    if (typeof pickImageFiles !== 'function') return showToast?.('未授权：files.pickImages', { kind: 'error' })

    activateComposerDraftForCurrentSession(state)
    const draftKey = activeComposerDraftKey(state)
    if (!draftKey) return showToast?.('请先选择会话', { kind: 'error' })
    const draft = readComposerDraftByKey(state, draftKey)
    const left = Math.max(0, MAX_DRAFT_IMAGES - draft.images.length)
    if (!left) return showToast?.(`最多选择 ${MAX_DRAFT_IMAGES} 张图片`, { kind: 'error' })

    try {
      const items = await pickImageFiles(left)
      const list = Array.isArray(items) ? items : []
      let added = 0
      for (const it of list) {
        const name = String(it?.name || '图片')
        const dataUrl = String(it?.dataUrl || '')
        if (addDraftImage(name, dataUrl, draftKey)) added++
      }
      if (!added) showToast?.('未选择图片', { kind: 'error' })
    } catch (e) {
      showToast?.(String((e as any)?.message || e || '选择图片失败'), { kind: 'error' })
    } finally {
      renderComposer()
    }
  }

  async function addDraftImagesFromFiles(files: File[]) {
    const state = getState()
    if (state.loading) return

    const list = Array.isArray(files)
      ? files.filter((f) => f instanceof File && String(f.type || '').startsWith('image/'))
      : []
    if (!list.length) return showToast?.('未识别到图片', { kind: 'error' })

    const draftKey = activeComposerDraftKey(state)
    if (!draftKey) return showToast?.('请先选择会话', { kind: 'error' })
    activateComposerDraftForCurrentSession(state)
    const draft = readComposerDraftByKey(state, draftKey)
    const left = Math.max(0, MAX_DRAFT_IMAGES - draft.images.length)
    if (!left) return showToast?.(`最多选择 ${MAX_DRAFT_IMAGES} 张图片`, { kind: 'error' })

    let added = 0
    for (const f of list.slice(0, left)) {
      try {
        const dataUrl = await readImageFileAsDataUrl(f)
        if (addDraftImage(String(f?.name || '图片'), dataUrl, draftKey)) added++
      } catch (_) {}
    }

    if (!added) showToast?.('未识别到图片', { kind: 'error' })
    renderComposer()
  }

  function buildRunImages(draftImages: any[]) {
    const list: any[] = []
    for (const image of draftImages) {
      const dataUrl = String(image?.dataUrl || '').trim()
      if (!looksLikeImageDataUrl(dataUrl)) throw new Error(`图片无效：${String(image?.name || '图片')}`)
      list.push({ kind: 'image', name: String(image?.name || '图片'), dataUrl })
    }
    return list
  }

  return {
    pickDraftImages,
    addDraftImagesFromFiles,
    buildRunImages,
  }
}
