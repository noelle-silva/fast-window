// 流式压力素材生成：构造「思考链式、公式密集」的 Markdown 文本，
// 以及它的逐段累积前缀序列（模拟流式输出时文本逐步增长的样子）。
// 只负责造数据，不掺任何渲染逻辑，便于被不同基准复用。

export type FormulaHeavyFixtureOptions = {
  // 生成多少个「公式段落」；每段含一个展示公式与若干行内公式。
  formulaCount: number
  // 每个公式段落前铺多少句白话，模拟思考链的叙述密度。
  prosePerFormula?: number
  seed?: number
}

const INLINE_TEMPLATES = [
  '设 $x_{i} = \\alpha_{i} + \\beta_{i} y_{i}$，代入可得 $\\nabla_{\\theta} L = 0$。',
  '由 $f(n) = \\sum_{k=1}^{n} k^{2}$ 与 $g(n) = O(n^{3})$ 可知 $f(n) \\sim \\frac{n^{3}}{3}$。',
  '这里 $\\mathcal{H}$ 是希尔伯特空间，$\\langle u, v \\rangle$ 为其内积。',
  '记 $\\hat{y} = \\operatorname{softmax}(W x + b)$，损失为 $\\ell = -\\log \\hat{y}_{c}$。',
]

const DISPLAY_TEMPLATES = [
  '$$\n\\int_{0}^{\\infty} e^{-x^{2}}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$',
  '$$\n\\frac{\\partial}{\\partial t} \\rho + \\nabla \\cdot (\\rho \\mathbf{u}) = 0\n$$',
  '$$\n\\mathbb{E}[X] = \\int_{\\Omega} X(\\omega)\\,dP(\\omega), \\qquad \\operatorname{Var}(X) = \\mathbb{E}[X^{2}] - \\mathbb{E}[X]^{2}\n$$',
  '$$\n\\mathcal{L}(\\theta) = \\frac{1}{N} \\sum_{i=1}^{N} \\left\\| f_{\\theta}(x_{i}) - y_{i} \\right\\|^{2} + \\lambda \\|\\theta\\|_{2}^{2}\n$$',
  '$$\n\\left[ \\begin{matrix} a & b \\\\ c & d \\end{matrix} \\right]^{-1} = \\frac{1}{ad - bc} \\left[ \\begin{matrix} d & -b \\\\ -c & a \\end{matrix} \\right]\n$$',
]

const PROSE_SENTENCES = [
  '我们先把问题拆成可验证的小步，再逐项检查每个假设是否成立。',
  '注意到上式在边界处退化，因此需要引入正则项来约束解的空间。',
  '接下来考察极限情形：当参数趋于无穷时，主导项会吞掉所有低阶修正。',
  '换一个视角，把它看成算子在本征基下的对角化问题会更清楚。',
  '这一步的关键是把耦合的变量解耦，从而让每一项可以独立估计。',
]

// 确定性伪随机：给定种子产生稳定序列，保证基准可复现。
function makeRng(seed: number) {
  let s = (seed >>> 0) || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function pick<T>(list: T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length) % list.length]
}

export function buildFormulaHeavyFixture(options: FormulaHeavyFixtureOptions): string {
  const count = Math.max(1, Math.floor(options.formulaCount || 1))
  const prosePerFormula = Math.max(0, Math.floor(options.prosePerFormula ?? 2))
  const rng = makeRng(options.seed ?? 20261002)

  const parts: string[] = []
  parts.push('## 思考过程\n')
  parts.push('让我们系统地推导这个问题，逐步验证每一步。\n')

  for (let i = 0; i < count; i++) {
    parts.push(`\n### 第 ${i + 1} 步\n`)
    for (let p = 0; p < prosePerFormula; p++) {
      parts.push(pick(PROSE_SENTENCES, rng) + '\n')
    }
    parts.push(pick(INLINE_TEMPLATES, rng) + '\n')
    parts.push(pick(DISPLAY_TEMPLATES, rng) + '\n')
  }

  parts.push('\n综上，所有步骤验证完毕，结论成立。\n')
  return parts.join('')
}

// 把整段文本切成「累积前缀」序列：第 i 项为前 i 个字符。
// 流式输出时每一步渲染的就是这样一个前缀。
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

// 统计文本里会被公式能力认领的公式数量（与 math 能力的匹配规则保持一致）。
export function countFormulas(text: string): number {
  const s = String(text || '')
  let n = 0
  n += (s.match(/\$\$\s*[\s\S]*?\s*\$\$/g) || []).length
  n += (s.match(/\\\[\s*[\s\S]*?\s*\\\]/g) || []).length
  n += (s.match(/\\\(\s*[\s\S]*?\s*\\\)/g) || []).length
  n += (s.match(/\$[^\$\n]+?\$/g) || []).length
  return n
}
