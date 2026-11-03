import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { BenchTheme } from './theme'
import { runAll } from './runBench'
import type { BenchResults } from './types'

type BenchApi = {
  runAll: () => Promise<BenchResults>
}

declare global {
  interface Window {
    __BENCH__?: BenchApi
    __BENCH_READY__?: boolean
    __BENCH_ERROR__?: string
  }
}

function boot() {
  const rootEl = document.getElementById('bench-root')
  if (!rootEl) throw new Error('bench-root 不存在')

  // 先装一次主题与全局样式；各测量项会自行挂载/卸载自己的 React 根。
  flushSync(() => {
    createRoot(rootEl).render(
      <BenchTheme>
        <span />
      </BenchTheme>,
    )
  })

  window.__BENCH__ = { runAll }
  window.__BENCH_READY__ = true
}

try {
  boot()
} catch (error) {
  window.__BENCH_ERROR__ = error instanceof Error ? error.stack || error.message : String(error)
  console.error(error)
}
