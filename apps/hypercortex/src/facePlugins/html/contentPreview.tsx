import * as React from 'react'

import type { FaceContentPreviewProps } from '../protocol'
import { HtmlFaceIframe } from './HtmlFaceIframe'

/** 版本历史等只读场景的内容预览：以自然撑开的 iframe 呈现，与迁移前行为一致。 */
export function HtmlFaceContentPreview({ content }: FaceContentPreviewProps): React.ReactNode {
  return <HtmlFaceIframe html={content} mode="natural" minHeightPx={360} />
}
