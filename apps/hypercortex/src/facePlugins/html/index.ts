import type { FaceViewPlugin } from '../protocol'
import { HtmlFaceEditView } from './editView'
import { HtmlFaceReadView } from './readView'
import { HTML_FACE_SETTINGS } from './settings'
import { HtmlFaceFullscreenToolbar, HtmlFaceScaleToolbar } from './toolbar'

/** 网页面（html）的界面半包：阅读态视窗、编辑态视窗、工具条插槽与可配置项声明。 */
export const htmlFaceViewPlugin: FaceViewPlugin = {
  kind: 'html',
  defaultViewState: {},
  ReadView: HtmlFaceReadView,
  EditView: HtmlFaceEditView,
  Toolbars: { left: HtmlFaceFullscreenToolbar, right: HtmlFaceScaleToolbar },
  settings: HTML_FACE_SETTINGS,
  settingsTitle: 'HTML 面显示策略',
  settingsIntro: '控制「HTML 面」的 iframe 在查看（非编辑）状态下的尺寸行为。',
}
