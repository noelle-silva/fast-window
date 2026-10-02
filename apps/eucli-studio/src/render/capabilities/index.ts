import type { AiChatCapabilities } from '../../gateway/capabilities'
import type { BoolRef } from '../types'
import type { RenderCapability } from '../contract'
import type { createRefImageHydrator } from '../refImages'
import type { createMathRenderer } from '../mathRender'
import { createMathCapability } from './math'
import { createMermaidCapability } from './mermaid'
import { createStickerCapability } from './sticker'
import { createImageCapability } from './image'
import { createHtmlCapability } from './html'

// 能力装配入口：把全部渲染能力按契约组装成能力集合。
//
// 这是唯一新增能力需要改动的地方——渲染引擎只接收本函数产出的能力集合，
// 不认识任何具体能力实现。新增渲染能力 = 新增一个能力单元 + 在下方登记一行。
export type RenderCapabilityDeps = {
  capabilities: AiChatCapabilities
  mermaidInited: BoolRef
  mermaidSvgCache: Map<string, string>
  mathRenderer: ReturnType<typeof createMathRenderer>
  refImages: ReturnType<typeof createRefImageHydrator>
}

export function createRenderCapabilities(deps: RenderCapabilityDeps): RenderCapability[] {
  return [
    createMathCapability({ mathRenderer: deps.mathRenderer }),
    createMermaidCapability({ mermaidInited: deps.mermaidInited, mermaidSvgCache: deps.mermaidSvgCache, capabilities: deps.capabilities }),
    createStickerCapability(),
    createImageCapability({ refImages: deps.refImages }),
    createHtmlCapability(),
  ]
}
