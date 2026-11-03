export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

export function makeStats(samples: number[]) {
  return {
    medianMs: median(samples),
    minMs: samples.length ? Math.min(...samples) : 0,
    maxMs: samples.length ? Math.max(...samples) : 0,
    samples: samples.slice(),
  }
}

// 强制一次文档级排版。读取 body.offsetHeight 会同步计算整棵已连接 DOM 的布局，
// 因此「渲染 + 强制排版」才是可比较的端到端成本；只在渲染后读 detached 节点没有意义。
export function forceLayout() {
  void document.body.offsetHeight
  void document.documentElement.scrollHeight
}

export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

export async function waitFrames(count = 2): Promise<void> {
  for (let i = 0; i < count; i += 1) await nextFrame()
}

export function elementNodes(root: Element): number {
  return root.querySelectorAll('*').length
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
