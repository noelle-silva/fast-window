import { createTextContentStore } from '../content'
import type { FaceViewPlugin } from '../protocol'
import { HtmlFaceContentPreview } from './contentPreview'
import { HtmlFaceEditView } from './editView'
import { extractHtmlFaceRefs } from './extractRefs'
import { HtmlFaceReadView } from './readView'
import { HtmlFaceFullscreenToolbar, HtmlFaceScaleToolbar } from './toolbar'

/** 网页面（html）的界面半包：阅读态视窗、编辑态视窗、内容预览、工具条插槽与引用提取。 */
export const htmlFaceViewPlugin: FaceViewPlugin = {
  kind: 'html',
  defaultViewState: {},
  ReadView: HtmlFaceReadView,
  EditView: HtmlFaceEditView,
  createContentStore: ({ initialContent, savedContent }) => createTextContentStore(initialContent, savedContent ?? initialContent),
  Toolbars: { left: HtmlFaceFullscreenToolbar, right: HtmlFaceScaleToolbar },
  ContentPreview: HtmlFaceContentPreview,
  extractRefs: extractHtmlFaceRefs,
}
