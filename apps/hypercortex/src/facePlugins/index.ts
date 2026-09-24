import { listNoteFaceAdapters } from '../noteFaces'
import { htmlFaceViewPlugin } from './html'
import { markdownFaceViewPlugin } from './markdown'
import { getFaceViewPlugin, registerFaceViewPlugin } from './protocol'

/**
 * 官方面视窗插件装配清单：宿主只登记插件模块，不包含任何具体面的界面实现。
 * 装配期校验声明与视窗实现一致（每个声明类型必须有阅读态视窗，可编辑面必须有编辑态视窗）。
 */
export function assembleFaceViewPlugins(): void {
  registerFaceViewPlugin(markdownFaceViewPlugin)
  registerFaceViewPlugin(htmlFaceViewPlugin)
  validateFaceViewPlugins()
}

function validateFaceViewPlugins(): void {
  for (const adapter of listNoteFaceAdapters()) {
    const plugin = getFaceViewPlugin(adapter.kind)
    if (!plugin) throw new Error(`面视窗缺失：${adapter.kind}`)
    if (adapter.capabilities.editable && !plugin.EditView) {
      throw new Error(`可编辑面缺少编辑态视窗：${adapter.kind}`)
    }
  }
}

assembleFaceViewPlugins()

export { getFaceViewPlugin, listFaceViewPlugins } from './protocol'
export type { FaceEditViewProps, FaceReadViewProps, FaceSettingField, FaceSettingOption, FaceToolbarProps, FaceToolbarSlot, FaceViewContext, FaceViewPlugin } from './protocol'
