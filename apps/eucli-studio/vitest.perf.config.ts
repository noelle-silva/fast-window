import { defineConfig } from 'vitest/config'

// 性能基准专用配置：只跑 *.perf.test.ts，给足超时，供 `pnpm test:perf` 单独驱动。
// 通过环境变量 PERF_PROFILE=smoke|stress|brutal 选择负载档位（默认 stress）。
export default defineConfig({
  test: {
    include: ['src/**/*.perf.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 600000,
    hookTimeout: 600000,
    fileParallelism: false,
    reporters: ['verbose'],
    // 压力档素材与 DOM 规模大，给 worker 足量堆内存，并暴露 gc 供内存探针强制回收，
    // 以区分「真泄漏」与「GC 尚未回收」，避免 happy-dom 环境本身 OOM 造成误判。
    poolOptions: {
      forks: { execArgv: ['--max-old-space-size=8192', '--expose-gc'] },
      threads: { execArgv: ['--max-old-space-size=8192', '--expose-gc'] },
    },
  },
})
