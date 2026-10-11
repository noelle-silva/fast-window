import * as React from 'react'

import type { FaceContentPreviewProps } from '../protocol'
import { MindmapCanvas } from './MindmapCanvas'

/** 版本历史等只读场景的内容预览：只读导图。 */
export function MindmapContentPreview({ content }: FaceContentPreviewProps): React.ReactNode {
  return <MindmapCanvas content={content} readonly layout="mindMap" theme="default" scale={1} />
}
