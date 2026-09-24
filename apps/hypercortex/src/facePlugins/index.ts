import { htmlFaceViewPlugin } from './html'
import { markdownFaceViewPlugin } from './markdown'
import { registerFaceViewPlugin } from './protocol'

/**
 * 官方面视窗插件装配清单：宿主只登记插件模块，不包含任何具体面的界面实现。
 * 声明与视窗实现的一致性校验在声明写入仓库时执行（setFaceDeclarations）。
 */
export function assembleFaceViewPlugins(): void {
  registerFaceViewPlugin(markdownFaceViewPlugin)
  registerFaceViewPlugin(htmlFaceViewPlugin)
}

assembleFaceViewPlugins()

export { getFaceViewPlugin, listFaceViewPlugins, validateFaceViewPluginsAgainstDeclarations } from './protocol'
export { useFaceContent } from './content'
export {
  faceManifestFromDeclaration,
  getCreatableFaceDeclarations,
  getFaceDeclaration,
  getFaceDeclarations,
  getFaceKindOrder,
  requireFaceDeclaration,
  setFaceDeclarations,
  useFaceDeclarations,
} from './declarations'
export type {
  FaceContentPreviewProps,
  FaceContentStore,
  FaceEditViewProps,
  FaceReadViewProps,
  FaceSettingField,
  FaceSettingOption,
  FaceToolbarProps,
  FaceToolbarSlot,
  FaceViewContext,
  FaceViewPlugin,
} from './protocol'
export type { FaceManifestOverrides } from './declarations'
export type { FaceDeclaration } from '../shared/faceDeclarations'
