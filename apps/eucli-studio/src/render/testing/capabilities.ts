import type { AiChatCapabilities } from '../../gateway/capabilities'

// 渲染测试用的能力桩：只提供渲染链实际用到的最小能力。
export function createRenderTestCapabilities(): AiChatCapabilities {
  return {
    meta: { appId: 'render-test', runtime: 'ui' },
    files: { images: { read: async () => '' } },
    ui: {},
    clipboard: {},
  } as any
}
