import { tokenizeFences, splitInlineCodeSpans } from '../fences'

// ============================================================================
// 公式解析前保护
//
// 为什么必须在解析前做：
//   Markdown 会把反斜杠当转义符处理——`\,` 变成 `,`、`\\` 变成 `\`、`\|` 变成 `|`。
//   而 TeX 里这些全是合法且常用的命令（细空格、矩阵换行、范数）。
//   若在 Markdown 解析之后再认领，公式内容已经被破坏，渲染结果会错。
//
// 这不是架构缺陷，而是「TeX 语法与 Markdown 转义天然冲突」这一内容特性决定的：
// 任何在 Markdown 之上的渲染体系（含 unified 生态）都必须先保护公式。
//
// 做法：解析前把公式换成唯一占位符，解析完成后再由 rehype 插件还原成公式宿主。
// 代码围栏与行内代码内的内容不参与保护。
// ============================================================================

export type MathClaim = { tex: string; display: boolean }

type Segment = { start: number; end: number; tex: string; display: boolean }

const INLINE_MATH_GUARD = /[A-Za-z\\]|[_^]/

const PATTERNS: Array<{ re: RegExp; display: boolean; guard?: RegExp }> = [
  { re: /\$\$([\s\S]*?)\$\$/g, display: true },
  { re: /\\\[([\s\S]*?)\\\]/g, display: true },
  { re: /\\\(([\s\S]*?)\\\)/g, display: false },
  { re: /\$([^$\n]+?)\$/g, display: false, guard: INLINE_MATH_GUARD },
]

export const MATH_PLACEHOLDER_RE = /@@FWMATH(\d+)@@/g

function scan(text: string): Segment[] {
  const found: Segment[] = []

  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0
    let m: RegExpExecArray | null = null
    while ((m = pattern.re.exec(text))) {
      const tex = String(m[1] || '').trim()
      if (!tex) continue
      if (pattern.guard && !pattern.guard.test(tex)) continue
      found.push({ start: m.index, end: m.index + m[0].length, tex, display: pattern.display })
    }
  }

  found.sort((a, b) => a.start - b.start)

  // 去重叠：先出现者优先（$$ 与 $ 会互相覆盖）
  const result: Segment[] = []
  let cursor = -1
  for (const seg of found) {
    if (seg.start < cursor) continue
    result.push(seg)
    cursor = seg.end
  }
  return result
}

function replaceInText(text: string, claims: MathClaim[]): string {
  if (!text.includes('$') && !text.includes('\\[') && !text.includes('\\(')) return text

  const segments = scan(text)
  if (!segments.length) return text

  let out = ''
  let last = 0
  for (const seg of segments) {
    out += text.slice(last, seg.start)
    const index = claims.length
    claims.push({ tex: seg.tex, display: seg.display })
    out += `@@FWMATH${index}@@`
    last = seg.end
  }
  out += text.slice(last)
  return out
}

// protectMath 把原文里的公式换成占位符，返回替换后的文本与公式清单。
export function protectMath(source: string): { text: string; claims: MathClaim[] } {
  const claims: MathClaim[] = []
  const src = String(source || '')
  if (!src.includes('$') && !src.includes('\\[') && !src.includes('\\(')) {
    return { text: src, claims }
  }

  const out = tokenizeFences(src)
    .map((token) => {
      // 代码围栏内不保护
      if (token.kind === 'fence') return token.raw
      return splitInlineCodeSpans(token.text)
        .map((part) => (part.kind === 'code' ? part.value : replaceInText(part.value, claims)))
        .join('')
    })
    .join('')

  return { text: out, claims }
}
