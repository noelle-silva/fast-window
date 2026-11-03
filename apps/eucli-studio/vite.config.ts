import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type DepOptimizationConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

type DepOptimizePlugin = NonNullable<NonNullable<DepOptimizationConfig['esbuildOptions']>['plugins']>[number]

// ============================================================================
// Worker 专用依赖解析修正
//
// decode-named-character-reference 的 browser 条件指向 index.dom.js，该文件在
// 模块顶层调用 document.createElement，Worker 中会直接抛 "document is not defined"。
//
// 不能用 alias 直接改写到 'decode-named-character-reference/index.js'：
// 当前安装版本（1.3.0）的 exports 只有条件键，没有 "./*" 通配，子路径无法解析。
//
// 这里先按正常规则解析出真实入口，再把同目录下的 index.dom.js 换成纯 JS 的
// index.js。路径来自实际解析结果，不绑定 .pnpm 或具体版本号；若未来版本缺少
// 该文件则立即报错，避免静默退回 DOM 实现。
// ============================================================================
function pureDecodeNamedCharacterReference(): Plugin {
  return {
    name: 'fw:decode-named-character-reference-pure',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source !== 'decode-named-character-reference') return null

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null

      const cleanId = resolved.id.replace(/[?#].*$/, '')
      if (!/[\\/]index\.dom\.js$/.test(cleanId)) return null

      const pureEntry = join(dirname(cleanId), 'index.js')
      if (!existsSync(pureEntry)) {
        this.error(`decode-named-character-reference 缺少纯 JS 实现：${pureEntry}`)
      }

      return { id: pureEntry, moduleSideEffects: resolved.moduleSideEffects }
    },
  }
}

// 依赖预打包走 esbuild，不经过上面的 Vite resolve 插件，因此需要同一条覆盖规则。
// 用 Node 默认条件解析（该包 default 条件就是纯 JS 入口），再交给 esbuild 打包。
function pureDecodeNamedCharacterReferenceEsbuild(): DepOptimizePlugin {
  return {
    name: 'fw:decode-named-character-reference-pure-esbuild',
    setup(build) {
      build.onResolve({ filter: /^decode-named-character-reference$/ }, (args) => {
        if (!args.importer) return null
        return { path: createRequire(args.importer).resolve('decode-named-character-reference') }
      })
    },
  }
}

export default defineConfig({
  clearScreen: false,
  plugins: [react(), pureDecodeNamedCharacterReference()],
  worker: {
    // Worker 内使用 ESM，支持顶层 import 与代码分割。
    format: 'es',
    // 关键：Vite 的 Worker 构建不会继承顶层 plugins。
    // 必须在这里显式挂同一条解析修正，否则后台包会退回 browser 条件，
    // 把 decode-named-character-reference/index.dom.js（顶层 document 调用）打进去。
    // worker.plugins 必须是返回插件数组的函数。
    plugins: () => [pureDecodeNamedCharacterReference()],
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [pureDecodeNamedCharacterReferenceEsbuild()],
    },
  },
  server: {
    port: 1431,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      // workerEntry 是后台分块的构建入口：保证批量预计算所需的 Worker
      // 始终随应用产出，即使当前尚未有运行时代码引用线程池。
      input: {
        main: 'index.html',
        workerEntry: 'src/render/worker/workerEntry.ts',
      },
    },
  },
})
