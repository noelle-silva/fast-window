import * as React from 'react'
import { createPortal } from 'react-dom'

export type AssetPreviewToolbarHost = Element | null

export function AssetPreviewToolbarPortal({
  host,
  children,
}: {
  host: AssetPreviewToolbarHost | undefined
  children: React.ReactNode
}) {
  if (!host) return null
  return createPortal(children, host)
}
