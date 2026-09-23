export interface DraftImageItem {
  id: string
  name: string
  dataUrl: string
}

export function removeDraftImage(images: DraftImageItem[], id: string): DraftImageItem[] {
  const rid = String(id || '')
  if (!rid) return images
  return images.filter((x) => String(x?.id || '') !== rid)
}
