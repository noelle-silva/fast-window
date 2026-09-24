import * as React from 'react'

import { CodeMirrorCodeEditor } from '../../editor/CodeMirrorCodeEditor'
import type { FaceEditViewProps } from '../protocol'

/** 网页面编辑态视窗：HTML 源码编辑器。 */
export function HtmlFaceEditView({ content, visible, onChange }: FaceEditViewProps): React.ReactNode {
  return (
    <CodeMirrorCodeEditor
      value={content}
      onChange={onChange}
      placeholder="输入 HTML 代码..."
      minHeight={420}
      active={visible}
      ariaLabel="编辑 HTML 正文代码"
      lineWrapping
      mode="html"
    />
  )
}
