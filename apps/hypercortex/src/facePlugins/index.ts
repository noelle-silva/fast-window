import { getNoteFaceAdapter } from '../noteFaces'
import { markdownFaceViewPlugin } from './markdown'
import { listFaceViewPlugins, registerFaceViewPlugin } from './protocol'

/**
 * 官方面视窗插件装配清单：宿主只登记插件模块，不包含任何具体面的界面实现。
 * 装配期校验：已注册插件的类型必须来自面声明，可编辑面必须有编辑态视窗。
 * 过程 3（网页面迁移）完成后，校验升级为「面声明全量覆盖」。
 */
export function assembleFaceViewPlugins(): void {
  registerFaceViewPlugin(markdownFaceViewPlugin)
  validateRegisteredFaceViewPlugins()
}

function validateRegisteredFaceViewPlugins(): void {
  for (const plugin of listFaceViewPlugins()) {
    const adapter = getNoteFaceAdapter(plugin.kind)
    if (!adapter) throw new Error(`面视窗插件的类型未在面声明中注册：${plugin.kind}`)
    if (adapter.capabilities.editable && !plugin.EditView) {
      throw new Error(`可编辑面缺少编辑态视窗：${plugin.kind}`)
    }
  }
}

assembleFaceViewPlugins()

export { getFaceViewPlugin, listFaceViewPlugins } from './protocol'
export type { FaceEditViewProps, FaceReadViewProps, FaceToolbarProps, FaceViewContext, FaceViewPlugin } from './protocol'
