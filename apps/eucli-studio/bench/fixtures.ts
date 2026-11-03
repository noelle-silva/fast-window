// 基准内容样本：四种典型消息形态 + 批量变体。
// 样本保持稳定、可读、长度接近真实助手回复，避免用超短字符串美化数字。

export type Fixture = {
  id: 'text' | 'formula' | 'table' | 'code'
  label: string
  text: string
}

const TEXT = `## 渲染管线概览

当前助手消息的渲染分成四段：**Markdown 解析**、HTML 序列化、消毒、以及增量 DOM 提交。每一段都只做一件事，方便单独观察成本。

1. 解析阶段把 Markdown 转成 HTML 字符串；
2. 消毒阶段过滤危险标签与属性；
3. 提交阶段按顶层块做前缀复用，只重建变化尾部；
4. 收尾阶段挂上公式、表格、代码复制等交互能力。

在流式输出时，消息会被反复重渲染。真正的成本并不只来自 Markdown 解析，还包括每一次 \`innerHTML\` 解析、样式计算和强制排版。因此基准必须把 DOM 提交与布局一起计量，否则得到的只是半截数字。

> 一个稳定的基线比一次漂亮的低值更有价值。

常见排查顺序是：先确认每条消息成本是否恒定，再看批量上屏是否出现超线性增长，最后检查主线程长任务是否被固定等待掩盖。`

const FORMULA = `## 公式与排版

行内公式常用于描述变量，例如 $E = mc^2$、$\\alpha + \\beta = \\gamma$，以及带上下标的 $x_{i}^{2}$。当公式与中文混排时，KaTeX 的字形与基线会影响行高。

展示公式会生成额外的块级盒子：

$$
\\begin{aligned}
\\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\
\\nabla \\times \\mathbf{B} &= \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}
\\end{aligned}
$$

再给一个矩阵与范数：

$$
\\left\\| A \\right\\|_2 = \\sqrt{\\lambda_{\\max}(A^{\\mathsf{T}} A)}
\\qquad
A = \\begin{bmatrix}
a_{11} & a_{12} \\\\
a_{21} & a_{22}
\\end{bmatrix}
$$

公式越多，KaTeX 的 HTML 节点越多，强制排版时浏览器需要处理的盒子也越多。基准会把这段内容完整渲染两次：一次预热，一次计量。`

const TABLE = `## 批量渲染观测

下表是一次会话打开过程中的阶段记录。表格包含工具条与横向滚动容器，因此它比纯文本多出一层 DOM 包装。

| 阶段 | 消息数 | 固定等待 | 主线程工作 | 备注 |
| --- | ---: | ---: | ---: | --- |
| 首屏 | 5 | 0 ms | 解析 + 提交 | 锚定在会话尾部 |
| 历史批 1 | 10 | 80 ms | 解析 + 提交 | 向上补齐 |
| 历史批 2 | 20 | 80 ms | 解析 + 提交 | 节点数继续增长 |
| 历史批 3 | 40 | 80 ms | 解析 + 提交 | 观察每批耗时 |
| 历史批 4 | 80 | 80 ms | 解析 + 提交 | 是否出现劣化 |
| 历史批 5 | 160 | 80 ms | 解析 + 提交 | 强制排版 |
| 历史批 6 | 320 | 80 ms | 解析 + 提交 | 总耗时对比 |
| 历史批 7 | 400 | 80 ms | 解析 + 提交 | 让出策略差异 |

表格右侧的数值列使用等宽数字，列宽变化会触发额外的布局计算。基准保留这一特性，因为它正是真实表格的成本来源。`

const CODE = `## 增量提交的边界

下面是一段接近真实实现的代码。代码块需要语法高亮容器、复制按钮与横向滚动条，节点数明显高于普通段落。

\`\`\`ts
type CommitResult = {
  changedFrom: number
  addedCount: number
  addedNodes: Element[]
  blocks: string[]
}

function commonPrefix(prev: string[], next: string[]): number {
  const limit = Math.min(prev.length, next.length)
  let i = 0
  while (i < limit && prev[i] === next[i]) i += 1
  return i
}

export function commitBlocks(
  host: HTMLElement,
  nextBlocks: string[],
  decorate?: (fragment: DocumentFragment) => void,
): CommitResult {
  const prev = blockCache.get(host) ?? { blocks: [], nodeCounts: [] }
  const keep = commonPrefix(prev.blocks, nextBlocks)

  let nodesToKeep = 0
  for (let i = 0; i < keep; i += 1) nodesToKeep += prev.nodeCounts[i] ?? 0
  while (host.childNodes.length > nodesToKeep) host.removeChild(host.lastChild as Node)

  const fragment = document.createDocumentFragment()
  for (let i = keep; i < nextBlocks.length; i += 1) {
    const tmp = document.createElement('div')
    tmp.innerHTML = nextBlocks[i]
    while (tmp.firstChild) fragment.appendChild(tmp.firstChild)
  }

  decorate?.(fragment)
  host.appendChild(fragment)
  return { changedFrom: keep, addedCount: fragment.childNodes.length, addedNodes: [], blocks: nextBlocks }
}
\`\`\`

代码块内的 \`<!-- -->\`、\`&lt;\` 与 \`&gt;\` 会被转义插件处理，避免被二次解析。`

const STAGED_TEXT = `### 阶段记录

这一段用于模拟会话打开时的历史批次：内容短、结构稳定，便于把「固定等待」与「时间片让出」的差异单独看出来。真实单条成本已经在单条与批量表中测量。

- 批次顺序：从旧到新追加；
- 每批 10 条；
- 末尾统一强制一次排版。`

export const FIXTURES: Fixture[] = [
  { id: 'text', label: '普通文本', text: TEXT },
  { id: 'formula', label: '公式', text: FORMULA },
  { id: 'table', label: '表格', text: TABLE },
  { id: 'code', label: '代码块', text: CODE },
]

export function variantText(text: string, tag: string | number): string {
  return `${text}\n\n> 基准变体 #${tag}：仅用于避开消息级缓存。`
}

export function makeBatchTexts(count: number, seed = 'batch'): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    out.push(variantText(TEXT, `${seed}-${i}`))
  }
  return out
}

export function makeStagedTexts(count: number, seed = 'staged'): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    out.push(variantText(STAGED_TEXT, `${seed}-${i}`))
  }
  return out
}
