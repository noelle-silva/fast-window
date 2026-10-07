import type { BackgroundClient } from '../gateway/backgroundClient'
import type { IconsService } from '../gateway/types'
import { HyperCortexRpc } from '../shared/rpcMethods'

// 实体图标服务出口：界面只表达「这个实体要哪种图标」，落盘、图片写文件与旧文件清理都在后端完成。
export function createIconsService(background: BackgroundClient): IconsService {
  return {
    updateNote: (scope, input) => background.invoke(HyperCortexRpc.icons.updateNote, { scope, ...input }),
    updateFolder: (scope, input) => background.invoke(HyperCortexRpc.icons.updateFolder, { scope, ...input }),
    updateAsset: (scope, input) => background.invoke(HyperCortexRpc.icons.updateAsset, { scope, ...input }),
    readImage: (scope, input) => background.invoke(HyperCortexRpc.icons.readImage, { scope, ...input }),
  }
}
