import * as React from 'react'
import { useEvent } from './useEvent'

export function useComposerAttachments(deps: {
  controller: any
  loading: boolean
  draftFilePickerInputRef: React.MutableRefObject<HTMLInputElement | null>
}) {
  const { controller, loading, draftFilePickerInputRef } = deps

  const [attachmentPickerEl, setAttachmentPickerEl] = React.useState<HTMLElement | null>(null)
  const [attachView, setAttachView] = React.useState<{ el: HTMLElement | null; mid: string; idx: number }>({ el: null, mid: '', idx: -1 })
  const [fileAdjust, setFileAdjust] = React.useState<{ el: HTMLElement | null; id: string }>({ el: null, id: '' })

  const closeAttachmentPicker = useEvent(() => setAttachmentPickerEl(null))
  const openAttachmentPicker = useEvent((e: React.MouseEvent<HTMLElement>) => setAttachmentPickerEl(e.currentTarget))
  const onPickDraftImages = useEvent(() => {
    controller.actions.pickDraftImages()
    closeAttachmentPicker()
  })
  const onPickDraftFiles = useEvent(() => {
    draftFilePickerInputRef.current?.click?.()
    closeAttachmentPicker()
  })
  const onPickFilesChanged = useEvent((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ''
    if (!files.length) return
    controller.actions.addDraftFilesFromFiles?.(files)
  })

  const closeAttachView = useEvent(() => setAttachView({ el: null, mid: '', idx: -1 }))
  const openAttachView = useEvent((e: React.MouseEvent<HTMLElement>, mid: string, idx: number) => {
    const id = String(mid || '').trim()
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    setAttachView({ el: e.currentTarget, mid: id, idx: Math.max(-1, Math.floor(Number(idx || 0))) })
  })

  const closeFileAdjust = useEvent(() => setFileAdjust({ el: null, id: '' }))
  const openFileAdjust = useEvent((e: React.MouseEvent<HTMLElement>, fileId: string) => {
    const id = String(fileId || '')
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    setFileAdjust({ el: e.currentTarget, id })
  })

  const onPaste = useEvent((e: React.ClipboardEvent) => {
    if (loading) return
    const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : []
    const files: File[] = []
    for (const it of items) {
      if (!it || it.kind !== 'file') continue
      const type = String(it.type || '')
      if (!type.startsWith('image/')) continue
      const f = it.getAsFile?.()
      if (f) files.push(f)
    }
    if (!files.length) return
    e.preventDefault()
    controller.actions.addDraftImagesFromFiles(files)
  })

  return {
    attachmentPickerEl,
    closeAttachmentPicker,
    openAttachmentPicker,
    onPickDraftImages,
    onPickDraftFiles,
    onPickFilesChanged,
    attachView,
    closeAttachView,
    openAttachView,
    fileAdjust,
    closeFileAdjust,
    openFileAdjust,
    onPaste,
  }
}
