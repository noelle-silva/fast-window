import * as React from 'react'

import { ImageDialog } from '../../ui/preview/ImageDialog'
import { MermaidDialog } from './MermaidDialog'
import type { usePreviewController } from '../../ui/preview/usePreviewController'

/** markdown 面的预览弹窗集合（图片 / Mermaid），阅读态与编辑态共用。 */
export function MarkdownPreviewDialogs({ preview }: { preview: ReturnType<typeof usePreviewController> }): React.ReactNode {
  return (
    <>
      <ImageDialog open={preview.modal === 'image'} controller={preview.controller} viewer={preview.imageViewer} />
      <MermaidDialog open={preview.modal === 'mermaid'} controller={preview.controller} mermaid={preview.mermaid} />
    </>
  )
}
