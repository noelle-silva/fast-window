import { createTextContentStore } from '../content'
import type { FaceViewPlugin } from '../protocol'
import { HtmlFaceContentPreview } from './contentPreview'
import { HtmlFaceEditView } from './editView'
import { HtmlFaceReadView } from './readView'
import { HtmlFaceFullscreenToolbar, HtmlFaceScaleToolbar } from './toolbar'

/** 网页面（html）的界面半包：阅读态视窗、编辑态视窗、内容预览与工具条插槽。 */
export const htmlFaceViewPlugin: FaceViewPlugin = {
  kind: 'html',
  defaultViewState: {},
  ReadView: HtmlFaceReadView,
  EditView: HtmlFaceEditView,
  createContentStore: ({ initialContent, savedContent }) => createTextContentStore(initialContent, savedContent ?? initialContent),
  Toolbars: { left: HtmlFaceFullscreenToolbar, right: HtmlFaceScaleToolbar },
  ContentPreview: HtmlFaceContentPreview,
}
