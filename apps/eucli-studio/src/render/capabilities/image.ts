import { markPreviewImages } from '../refImages'
import type { RenderCapability } from '../contract'

// 图片能力：负责预览图片标记与引用图片（data-ref-img）的异步加载。
// 引用图片只在本次新增节点上触发加载，缓存命中直接贴回，不整树重扫。
export function createImageCapability(deps: {
  refImages: { hydrateRefImages: (root: unknown) => void }
}): RenderCapability {
  const { refImages } = deps
  return {
    id: 'image',
    decorate(fragment) {
      markPreviewImages(fragment)
      refImages.hydrateRefImages(fragment)
    },
    permissions: ['files.images.read'],
  }
}
