import { decorateCodeBlocks, ensureCodeCopyHandlerOnce } from '../copy'
import type { RenderCapability } from '../contract'

// HTML 能力：负责渲染输出中代码块的交互装饰（复制按钮）。
// 内容认领与成品产出由 Markdown 基础渲染承担，本能力只做地盘内新增节点的装饰与委托。
export function createHtmlCapability(): RenderCapability {
  return {
    id: 'html',
    decorate(fragment) {
      decorateCodeBlocks(fragment)
    },
    bind(host) {
      ensureCodeCopyHandlerOnce(host)
    },
    permissions: ['clipboard.writeText', 'ui.showToast'],
  }
}
