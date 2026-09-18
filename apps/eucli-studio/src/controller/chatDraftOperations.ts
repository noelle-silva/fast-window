import { clamp, uid } from '../core/utils'
import { MAX_DRAFT_IMAGES, MAX_DRAFT_FILES, DEFAULT_ATTACH_SEND_LIMIT_CHARS } from '../domain/constants'
import { looksLikeImageDataUrl } from '../domain/textProcessing'
import { detectDraftFileKind, addDraftFilePlaceholder } from '../domain/draftFileUtils'
import type { DraftFileItem } from '../domain/draftFileUtils'
import {
  activeComposerDraftKey,
  activateComposerDraftForCurrentSession,
  readComposerDraftByKey,
  setComposerDraftFilesByKey,
  setComposerDraftImagesByKey,
} from '../domain/sessionComposerDrafts'
import type { createChatOperationsShared } from './chatOperationsShared'

export function createChatDraftOperations(shared: ReturnType<typeof createChatOperationsShared>) {
  const { deps } = shared
  const { getState, pickImageFiles, showToast, emit, renderComposer, readImageFileAsDataUrl, extractTextFromFile } = deps

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

  async function addDraftFilesFromFiles(files: File[]) {
    const state = getState()
    if (state.loading) return
    const list = Array.isArray(files) ? files.filter((f) => f instanceof File) : []
    if (!list.length) return
    const draftKey = activeComposerDraftKey(state)
    if (!draftKey) return showToast?.('请先选择会话', { kind: 'error' })
    activateComposerDraftForCurrentSession(state)
    const draft = readComposerDraftByKey(state, draftKey)
    const left = Math.max(0, MAX_DRAFT_FILES - draft.files.length)
    if (!left) return showToast?.(`最多选择 ${MAX_DRAFT_FILES} 个文件`, { kind: 'error' })

    let added = 0
    for (const f of list.slice(0, left)) {
      const kind = detectDraftFileKind(f)
      if (!kind) {
        showToast?.(`不支持的文件：${String(f?.name || '文件')}`, { kind: 'error' })
        continue
      }
      const nextFiles = readComposerDraftByKey(state, draftKey).files.slice()
      const it = addDraftFilePlaceholder(nextFiles, f, kind)
      if (!it) break
      setComposerDraftFilesByKey(state, draftKey, nextFiles)
      added++
      emit()
      ;(async () => {
        try {
          const r = await extractTextFromFile(f, kind)
          const currentState = getState()
          const currentDraft = readComposerDraftByKey(currentState, draftKey)
          const cur = currentDraft.files.find((x: any) => String(x?.id || '') === it.id) || null
          if (!cur) return
          cur.text = String(r || '')
          if (!cur.text) cur.error = '未提取到文本'
          setComposerDraftFilesByKey(currentState, draftKey, currentDraft.files)
        } catch (e) {
          const currentState = getState()
          const currentDraft = readComposerDraftByKey(currentState, draftKey)
          const cur = currentDraft.files.find((x: any) => String(x?.id || '') === it.id) || null
          if (!cur) return
          cur.error = String((e as any)?.message || e || '解析失败')
          setComposerDraftFilesByKey(currentState, draftKey, currentDraft.files)
        } finally {
          const currentState = getState()
          const currentDraft = readComposerDraftByKey(currentState, draftKey)
          const cur = currentDraft.files.find((x: any) => String(x?.id || '') === it.id) || null
          if (cur) cur.pending = false
          if (cur) setComposerDraftFilesByKey(currentState, draftKey, currentDraft.files)
          emit()
        }
      })().catch(() => {})
    }
    if (!added) showToast?.('未选择文件', { kind: 'error' })
    emit()
  }

  function currentAttachSendLimitChars() {
    const value = Number(stateDataSettings()?.attachments?.sendLimitChars ?? DEFAULT_ATTACH_SEND_LIMIT_CHARS)
    return clamp(Math.round(value), 1000, 2_000_000)
  }

  function stateDataSettings() {
    const state = getState()
    return state?.data?.settings && typeof state.data.settings === 'object' ? state.data.settings : {}
  }

  function buildRunAttachments(draftImages: any[], draftFiles: DraftFileItem[]) {
    const attachments: any[] = []
    for (const image of draftImages) {
      const dataUrl = String(image?.dataUrl || '').trim()
      if (!looksLikeImageDataUrl(dataUrl)) throw new Error(`图片无效：${String(image?.name || '图片')}`)
      attachments.push({ kind: 'image', name: String(image?.name || '图片'), dataUrl })
    }

    const sendLimit = currentAttachSendLimitChars()
    for (const file of draftFiles) {
      const name = String(file?.name || '文件')
      if (file?.pending) throw new Error('文件解析中，请稍候…')
      const error = String(file?.error || '').trim()
      if (error) throw new Error(`${name} 解析失败：${error}`)
      const raw = String(file?.text || '').trim()
      if (!raw) throw new Error(`${name} 未提取到可发送文本`)
      const sendPct = clamp(Math.round(Number(file?.sendPct ?? 100)), 0, 100)
      const fullLen = raw.length
      const sendLen = Math.max(0, Math.ceil((fullLen * sendPct) / 100))
      if (sendLen <= 0) throw new Error(`${name} 的发送内容为空`)
      if (sendLen > sendLimit) throw new Error(`${name} 发送内容超过限制，请在附件设置里调低发送比例`)
      attachments.push({ kind: String(file?.kind || 'txt'), name, lang: String(file?.kind || '') === 'md' ? 'markdown' : 'text', text: raw.slice(0, sendLen), fullLen, sendLen, sendPct })
    }
    return attachments
  }

  return {
    pickDraftImages,
    addDraftImagesFromFiles,
    addDraftFilesFromFiles,
    buildRunAttachments,
  }
}
