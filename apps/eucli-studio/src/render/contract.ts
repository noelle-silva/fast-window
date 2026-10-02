import type { AiChatCapabilities } from '../gateway/capabilities'
import type { RenderSafetyPolicy } from './types'

// ============================================================================
// eucli-studio 客户端渲染契约（唯一事实源）
//
// 本文件规定渲染生命周期的四件事与五条规矩。所有渲染能力（公式 / 图表 /
// 贴纸 / 图片 / HTML）都按同一份契约接入；渲染引擎只识别本契约，不识别任何
// 具体能力实现。新增渲染能力只需按契约新增一个能力单元，引擎不改。
//
// 五条规矩：
//   1. 地盘规矩：每条消息显示区域是该消息渲染的唯一地盘。能力只能在地盘内
//      的受控容器中产出，禁止直接操作页面根节点或全局共享区域。
//   2. 半成品规矩：内容分草稿态与成品态。草稿态只做朴素展示，不得交给易失败
//      的专用渲染器；只有语义完整（如代码围栏闭合）后才升级为成品态。
//   3. 换班规矩：地盘每次更新产生新版本。异步任务回填前必须核对目标仍在位
//      （节点仍在地盘内且版本未更新），不在位则丢弃结果，旧任务不得回写新画面。
//   4. 善后规矩：谁创建的临时资源谁负责收尾，成功与失败都必须收尾。
//   5. 失败隔离规矩：任一能力失败只影响自身，不得外溢到其他能力或整页。
// ============================================================================

// RenderContext 是一次渲染的地盘与生命周期信息，贯穿认领、成品产出、
// 装饰与收尾全过程。
export type RenderContext = {
  // 地盘：本次渲染的消息显示区域。能力的一切写入都必须落在它内部。
  host: HTMLElement
  // 地盘版本：每次 renderAssistantInto 递增。
  version: number
  // 目标是否仍在位：地盘仍挂载且版本未被更新。异步任务回填前必须核对。
  isCurrent: () => boolean
  // 渲染安全策略，决定清理强度。
  policy: RenderSafetyPolicy
  // 贴纸能力开关。
  stickersEnabled: boolean
  // 贴纸路径解析（贴纸能力在成品产出时使用）。
  getStickerPath: ((category: string, name: string) => string) | null
  // 宿主能力，供声明了 permissions 的能力取用。
  capabilities: AiChatCapabilities
}

// ClaimSink 交给能力的认领出口：能力把认领到的内容交给它，换回占位符。
// 占位符由内容形态层统一生成，能力无需关心格式。
// block=true 时产出块级占位，避免整块内容被 Markdown 包进 <p>。
export type ClaimSink = {
  push: (data: unknown, options?: { block?: boolean }) => string
}

// RenderCapability 是渲染能力契约。每种能力只回答同一组问题：
//   - 认领什么内容：claimText / claimFence
//   - 何时可开工：init
//   - 成品如何产出：placeholder
//   - 成品如何装饰：decorate
//   - 如何收尾：enhance
//   - 交互接线：bind
//   - 需要什么权限：permissions
export type RenderCapability = {
  // 能力标识，同时是占位符归属键。
  id: string
  // 认领纯文本区域中的内容（调用方已剥离行内代码）。返回替换占位符后的文本。
  claimText?: (text: string, ctx: RenderContext, claim: ClaimSink) => string
  // 认领一个已闭合的代码围栏。返回占位符；不认领则返回 null（保持草稿态）。
  claimFence?: (lang: string, content: string, ctx: RenderContext, claim: ClaimSink) => string | null
  // 认领一个已闭合的整块原始 HTML（含内嵌 SVG）。返回占位符；不认领则返回 null。
  // 用于防止 HTML 块被 Markdown 逐行解析破坏。
  claimHtmlBlock?: (raw: string, ctx: RenderContext, claim: ClaimSink) => string | null
  // 成品如何产出：把认领条目替换为地盘内的 HTML 片段。
  placeholder?: (data: unknown, ctx: RenderContext) => string
  // 成品如何装饰：只处理本次新增的节点。
  decorate?: (fragment: DocumentFragment, ctx: RenderContext) => void
  // 何时可开工：引擎预热时调用一次。
  init?: () => void | Promise<void>
  // 交互接线：在地盘根上绑定一次事件委托（幂等由能力自身保证）。
  bind?: (host: HTMLElement, ctx: RenderContext) => void
  // 如何收尾：异步产出与临时资源清理；必须在成功与失败都收尾。
  enhance?: (ctx: RenderContext) => void | Promise<void>
  // 需要什么权限：声明本能力用到的宿主能力。
  permissions?: readonly string[]
}
