// 全能力渲染素材库：覆盖五种渲染能力（公式 / 图表 / 贴纸 / 图片 / HTML）的
// 正常、边界、畸形、流式半成品变体。测试体系据此验证「渲染是否正确」与
// 「是否被破坏」，并作为视觉等价与切分等价的统一输入。
//
// 只负责造数据，不掺任何渲染逻辑。

export type Fixture = {
  name: string
  // 能力归属，便于按能力筛选与统计。
  capability: 'math' | 'mermaid' | 'sticker' | 'image' | 'html' | 'mixed'
  // 该素材是否语义完整（成品态）。未闭合围栏等草稿态素材为 false。
  complete: boolean
  // 该素材渲染后应出现的结构断言（选择器 -> 期望数量下限）。
  expect?: Record<string, number>
  // 结构禁止断言（选择器 -> 期望数量上限）。用于捕获「不该出现的注入」，
  // 例如 HTML 块被 Markdown 包进 <p>。这类现象在真实浏览器会丢图形，必须显式守护。
  forbid?: Record<string, number>
  text: string
}

// ---------------------------------------------------------------------------
// 公式能力
// ---------------------------------------------------------------------------

export const MATH_FIXTURES: Fixture[] = [
  {
    name: 'math.inline',
    capability: 'math',
    complete: true,
    text: '设 $x_{i} = \\alpha_{i}$，代入得 $\\nabla L = 0$。',
    expect: { '.math-inline[data-tex]': 2 },
  },
  {
    name: 'math.display',
    capability: 'math',
    complete: true,
    text: '公式如下：\n\n$$\n\\int_{0}^{1} x\\,dx = \\frac{1}{2}\n$$',
    expect: { '.math-block[data-tex]': 1 },
  },
  {
    name: 'math.bracket',
    capability: 'math',
    complete: true,
    text: '行内 \\(a+b\\) 与展示 \\[c^2\\] 都支持。',
    expect: { '.math-inline[data-tex]': 1, '.math-block[data-tex]': 1 },
  },
  {
    name: 'math.edge.notFormula',
    capability: 'math',
    complete: true,
    // 纯美元金额，不应被误判为公式。
    text: '这件衣服 $100 元，那件 $200 元。',
    expect: { '.math-inline[data-tex]': 0 },
  },
  {
    name: 'math.malformed',
    capability: 'math',
    complete: true,
    // 非法 TeX：应降级为可见内容，不得抛错中断整条渲染。
    text: '坏公式 $\\frac{1}{$ 之后仍有文字。',
    expect: {},
  },
]

// ---------------------------------------------------------------------------
// 图表能力
// ---------------------------------------------------------------------------

export const MERMAID_FIXTURES: Fixture[] = [
  {
    name: 'mermaid.closed',
    capability: 'mermaid',
    complete: true,
    // 渲染成功后 pre 会被替换为成品 .mermaid-block。
    text: '```mermaid\ngraph TD\n  A --> B\n```',
    expect: { '.mermaid-block[data-mermaid="1"]': 1 },
  },
  {
    name: 'mermaid.flowchartLang',
    capability: 'mermaid',
    complete: true,
    text: '```flowchart\nflowchart LR\n  X --> Y\n```',
    expect: { '.mermaid-block[data-mermaid="1"]': 1 },
  },
  {
    name: 'mermaid.streaming.unclosed',
    capability: 'mermaid',
    complete: false,
    // 未闭合：保持草稿态，不得产出成品。
    text: '```mermaid\ngraph TD\n  A --> B',
    expect: { '.mermaid-block[data-mermaid="1"]': 0 },
  },
  {
    name: 'mermaid.malformed',
    capability: 'mermaid',
    complete: true,
    // 语法错误：应就地降级为错误提示，不得污染页面。
    text: '```mermaid\ngraph TD\n  A --> \n```',
    expect: {},
  },
  {
    name: 'mermaid.notMermaid',
    capability: 'mermaid',
    complete: true,
    // 普通代码围栏不应被图表能力认领。
    text: '```js\nconst a = 1\n```',
    expect: { '.mermaid-block[data-mermaid="1"]': 0 },
  },
  {
    name: 'mermaid.insideMaxWidthWrapper',
    capability: 'mermaid',
    complete: true,
    // 真实场景：模型用 max-width 限宽容器包住图表。图表仍须正常渲染，
    // 且容器本身可被居中（布局行为由浏览器级验证守护）。
    text: '<div style="margin-top:18px;max-width:660px;">\n\n<div style="font-weight:700;">标题</div>\n\n```mermaid\ngraph LR\n  A --> B\n```\n\n</div>',
    expect: { '.mermaid-block[data-mermaid="1"]': 1 },
  },
]

// ---------------------------------------------------------------------------
// 贴纸能力
// ---------------------------------------------------------------------------

export const STICKER_FIXTURES: Fixture[] = [
  {
    name: 'sticker.basic',
    capability: 'sticker',
    complete: true,
    text: '你好 [[sticker:emoji/hi]] 呀',
    expect: { 'img.fw-sticker': 1 },
  },
  {
    name: 'sticker.sized',
    capability: 'sticker',
    complete: true,
    // 尺寸令牌是三段式：分类/名称/尺寸。
    text: '放大版 [[sticker:emoji/ok/64]]',
    expect: { 'img.fw-sticker[data-fw-sticker-size]': 1 },
  },
  {
    name: 'sticker.edge.invalidPath',
    capability: 'sticker',
    complete: true,
    // 越界路径：保持原文，不得产出图片。
    text: '非法 [[sticker:../secret/x]]',
    expect: { 'img.fw-sticker': 0 },
  },
  {
    name: 'sticker.edge.insideInlineCode',
    capability: 'sticker',
    complete: true,
    // 行内代码里的令牌不应被认领。
    text: '代码 `[[sticker:emoji/hi]]` 保留',
    expect: { 'img.fw-sticker': 0 },
  },
]

// ---------------------------------------------------------------------------
// 图片能力
// ---------------------------------------------------------------------------

export const IMAGE_FIXTURES: Fixture[] = [
  {
    name: 'image.markdown',
    capability: 'image',
    complete: true,
    text: '![示例图](https://example.com/a.png)',
    expect: { 'img[data-fw-img="1"]': 1 },
  },
  {
    name: 'image.refImg',
    capability: 'image',
    complete: true,
    text: '<img data-ref-img="sessions/roles/x/a.png" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" />',
    expect: { 'img[data-ref-img]': 1 },
  },
]

// ---------------------------------------------------------------------------
// HTML 能力
// ---------------------------------------------------------------------------

export const HTML_FIXTURES: Fixture[] = [
  {
    name: 'html.div',
    capability: 'html',
    complete: true,
    text: '<div class="card">\n  <span>hello</span>\n</div>',
    expect: { 'div.card': 1, 'div.card span': 1 },
  },
  {
    name: 'html.style',
    capability: 'html',
    complete: true,
    text: '<div style="color:#a03040;font-weight:700;">彩色文字</div>',
    expect: { 'div[style]': 1 },
  },
  {
    name: 'html.svg.blankLineBetweenShapes',
    capability: 'html',
    complete: true,
    // 关键回归（用户报告的真实场景）：HTML 块内出现空行，marked 会结束 HTML 块并把
    // 后续元素包进 <p>，浏览器丢弃 SVG 内的非法 <p>，图形随之消失。整块必须被保护。
    text: '<div style="display:flex; justify-content:center; margin:8px 0;">\n    <svg viewBox="0 0 540 210" style="width:100%; max-width:540px;">\n      <rect x="0" y="0" width="540" height="210" rx="10" fill="#fff" stroke="#eee"/>\n\n      <text x="110" y="22" fill="#b08a8a">原图 · 家居睡袍</text>\n      <path d="M62 34 Q110 28 158 34 L164 150 Z" fill="#e2a89e"/>\n      <ellipse cx="86" cy="182" rx="20" ry="9" fill="#f4eee6"/>\n\n      <path d="M252 105 L288 105" stroke="#c0a8c8"/>\n      <polygon points="288,100 298,105 288,110" fill="#c0a8c8"/>\n\n      <text x="428" y="22" fill="#8a4a5a">新图 · 酒红缎裙</text>\n      <path d="M380 34 Q428 30 476 34 L482 150 Z" fill="#6e1c2c"/>\n    </svg>\n  </div>',
    expect: { 'svg': 1, 'svg path': 3, 'svg ellipse': 1, 'svg rect': 1, 'svg polygon': 1, 'svg text': 2, 'svg p': 0 },
    // HTML 块完整性：块内不得出现 Markdown 注入的段落/换行标签。
    forbid: { 'svg p': 0, 'svg br': 0, 'div > p': 0 },
  },
  {
    name: 'html.svg.noBlankLine',
    capability: 'html',
    complete: true,
    text: '<svg viewBox="0 0 100 100">\n  <rect x="0" y="0" width="100" height="100"/>\n  <path d="M0 0 L100 100"/>\n</svg>',
    expect: { 'svg': 1, 'svg path': 1, 'svg rect': 1 },
  },
  {
    name: 'html.svg.nested',
    capability: 'html',
    complete: true,
    // 嵌套结构 + 空行：整块保护必须覆盖深层节点。
    text: '<div class="wrap">\n  <svg viewBox="0 0 40 40">\n    <g>\n\n      <circle cx="20" cy="20" r="10"/>\n    </g>\n  </svg>\n</div>',
    expect: { 'div.wrap svg circle': 1 },
  },
  {
    name: 'html.codeBlock',
    capability: 'html',
    complete: true,
    text: '```js\nconst a = 1\n```',
    expect: { 'pre code.language-js': 1 },
  },
  {
    name: 'html.streaming.unclosedDiv',
    capability: 'html',
    complete: false,
    // 流式半成品：未闭合 HTML 块。不得被破坏，也不得整块吞掉后续内容。
    text: '<div class="streaming">\n  <span>部分内容',
    expect: {},
  },
]

// ---------------------------------------------------------------------------
// 混合能力
// ---------------------------------------------------------------------------

export const MIXED_FIXTURES: Fixture[] = [
  {
    name: 'mixed.all',
    capability: 'mixed',
    complete: true,
    text: [
      '# 标题',
      '',
      '公式 $a^2+b^2=c^2$ 与贴纸 [[sticker:emoji/hi]]。',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '<div class="card">HTML 卡片</div>',
      '',
      '![图](https://example.com/a.png)',
    ].join('\n'),
    expect: {
      '.math-inline[data-tex]': 1,
      'img.fw-sticker': 1,
      '.mermaid-block[data-mermaid="1"]': 1,
      'div.card': 1,
      'img[data-fw-img="1"]': 1,
    },
  },
]

export const ALL_FIXTURES: Fixture[] = [
  ...MATH_FIXTURES,
  ...MERMAID_FIXTURES,
  ...STICKER_FIXTURES,
  ...IMAGE_FIXTURES,
  ...HTML_FIXTURES,
  ...MIXED_FIXTURES,
]

// 把整段文本切成累积前缀序列，模拟流式输出逐步增长的样子。
export function buildCumulativePrefixes(text: string, stepCount: number): string[] {
  const src = String(text || '')
  const steps = Math.max(1, Math.floor(stepCount || 1))
  if (!src) return ['']
  const out: string[] = []
  for (let i = 1; i <= steps; i++) {
    const end = Math.floor((src.length * i) / steps)
    out.push(src.slice(0, end))
  }
  out[out.length - 1] = src
  return out
}
