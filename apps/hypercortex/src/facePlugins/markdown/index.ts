import { createTextContentStore } from '../content'
import type { FaceViewPlugin } from '../protocol'
import { MarkdownEditView } from './editView'
import { extractMarkdownFaceRefs } from './extractRefs'
import { MarkdownReadView } from './readView'
import { MarkdownToolbar } from './toolbar'

/** 文本面（markdown）的界面半包：阅读态视窗、编辑态视窗、工具条插槽与引用提取。 */
export const markdownFaceViewPlugin: FaceViewPlugin = {
  kind: 'markdown',
  defaultViewState: { mode: 'live' },
  ReadView: MarkdownReadView,
  EditView: MarkdownEditView,
  createContentStore: ({ initialContent, savedContent }) => createTextContentStore(initialContent, savedContent ?? initialContent),
  Toolbars: { left: MarkdownToolbar },
  extractRefs: extractMarkdownFaceRefs,
}
