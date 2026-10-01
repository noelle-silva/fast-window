import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // 性能基准（*.perf.test.ts）是重负载分析工具，默认不参与常规回归；
    // 由 vitest.perf.config.ts + `pnpm test:perf` 单独驱动。
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.perf.test.ts'],
  },
})
