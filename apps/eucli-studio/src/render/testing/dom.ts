// 渲染测试共享的 DOM 工具：序列化、异步收尾等待、渲染驱动。
// 供常规渲染测试与性能测试台共用。

// 图表能力每次渲染生成唯一 id（uid('mm')），其派生节点 id 与引用都含该易变令牌。
// 它是非视觉差异，序列化前必须归一化，才能比较真正的画面。
export function normalizeVolatile(value: string): string {
  return String(value || '')
    .replace(/mm_[a-z0-9_]+/g, 'MMID')
    .replace(/mermaid-svg_[a-z0-9_]+/g, 'MMID')
}

// 把 DOM 序列化成与实现无关的规范签名（含装饰，用于比对最终视觉）。
export function serializeDom(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return `#text:${JSON.stringify(normalizeVolatile(String(node.textContent || '')))}`
  if (node.nodeType === Node.COMMENT_NODE) return `#comment:${JSON.stringify(normalizeVolatile(String(node.textContent || '')))}`
  if (node.nodeType !== Node.ELEMENT_NODE) return `#${node.nodeType}`
  const el = node as Element
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}=${JSON.stringify(normalizeVolatile(a.value))}`)
    .sort()
    .join(' ')
  const kids = Array.from(el.childNodes).map(serializeDom).join('')
  return `<${el.tagName.toLowerCase()} ${attrs}>[${kids}]`
}

export function serializeChildren(host: HTMLElement): string {
  return Array.from(host.childNodes).map(serializeDom).join('\n')
}

// 等待异步能力（图表等）收尾后再比对稳定画面。
export async function waitForAsyncSettle(host: HTMLElement, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!host.querySelectorAll('.mermaid-block[data-mermaid="0"]').length) return
    if (Date.now() > deadline) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

export type RenderIntoOptions = {
  stickersEnabled?: boolean
  getStickerPath?: (category: string, name: string) => string
  renderSafetyPolicy?: 'original' | 'baseline' | 'unsafe'
}

// 在独立宿主上渲染一次，返回宿主（已挂载，便于异步能力工作）。
export function renderInto(engine: { renderAssistantInto: (el: unknown, text: unknown, options?: any) => void }, text: string, options?: RenderIntoOptions): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  engine.renderAssistantInto(host, text, options)
  return host
}
