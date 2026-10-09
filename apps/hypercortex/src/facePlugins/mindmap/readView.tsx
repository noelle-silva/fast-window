import * as React from 'react'

import type { FaceReadViewProps } from '../protocol'

/** 思维导图面阅读态视窗：骨架实现，按真实渲染需求替换。 */
export function MindmapReadView({ content }: FaceReadViewProps): React.ReactNode {
  return (
    <div
      style={{
        height: '100%',
        boxSizing: 'border-box',
        padding: 16,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {content}
    </div>
  )
}
