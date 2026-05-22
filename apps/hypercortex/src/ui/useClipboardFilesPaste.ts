import * as React from 'react'
import { filesFromClipboardData } from '../services/pastedAssetUpload'

type Params = {
  enabled?: boolean
  onPasteFiles: (files: File[]) => void | Promise<void>
}

export function useClipboardFilesPaste({ enabled = true, onPasteFiles }: Params) {
  React.useEffect(() => {
    if (!enabled) return

    const handleWindowPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isEditablePasteTarget(event.target)) return
      const files = filesFromClipboardData(event.clipboardData)
      if (!files.length) return
      event.preventDefault()
      void onPasteFiles(files)
    }

    window.addEventListener('paste', handleWindowPaste)
    return () => window.removeEventListener('paste', handleWindowPaste)
  }, [enabled, onPasteFiles])
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null
  if (!element) return false
  if (element.closest('input, textarea, select, [role="textbox"]')) return true
  const contentEditable = element.closest('[contenteditable]')
  return contentEditable instanceof HTMLElement && contentEditable.isContentEditable
}
