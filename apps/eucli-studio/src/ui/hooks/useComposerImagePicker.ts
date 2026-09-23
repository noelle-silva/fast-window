import * as React from 'react'
import { useEvent } from './useEvent'

export function useComposerImagePicker(deps: {
  controller: any
  loading: boolean
}) {
  const { controller, loading } = deps

  const [imagePickerEl, setImagePickerEl] = React.useState<HTMLElement | null>(null)

  const closeImagePicker = useEvent(() => setImagePickerEl(null))
  const openImagePicker = useEvent((e: React.MouseEvent<HTMLElement>) => setImagePickerEl(e.currentTarget))
  const onPickDraftImages = useEvent(() => {
    controller.actions.pickDraftImages()
    closeImagePicker()
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
    imagePickerEl,
    closeImagePicker,
    openImagePicker,
    onPickDraftImages,
    onPaste,
  }
}
