import path from 'node:path'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const benchRoot = fileURLToPath(new URL('.', import.meta.url))
const appRoot = path.resolve(benchRoot, '..')
const repoRoot = path.resolve(appRoot, '..', '..')

function realOrSelf(target: string) {
  try {
    return realpathSync.native(target)
  } catch {
    return target
  }
}

// decode-named-character-reference 在 package exports 里把 browser 条件指向
// index.dom.js；该入口在模块顶层直接调用 document.createElement，Web Worker
// 中会立刻崩溃。基准只在这里把该模块固定到与 Node 相同的 index.js 实现，
// 不修改应用源码、不影响生产构建。
function resolveDecodeEntry() {
  const appRequire = createRequire(path.join(appRoot, 'package.json'))
  try {
    const remarkEntry = appRequire.resolve('remark-parse')
    const mdastEntry = createRequire(remarkEntry).resolve('mdast-util-from-markdown')
    return createRequire(mdastEntry).resolve('decode-named-character-reference')
  } catch {
    try {
      return appRequire.resolve('decode-named-character-reference')
    } catch {
      throw new Error(
        'bench 无法定位 decode-named-character-reference。请在 apps/eucli-studio 下确认依赖已安装（本脚本不会执行安装）。',
      )
    }
  }
}

export default defineConfig({
  root: benchRoot,
  // 基准页不需要 Fast Refresh，直接用 esbuild 的 automatic JSX。
  // 这样也避开 @vitejs/plugin-react 在 pnpm 严格布局下的 Babel 解析链。
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: [
      {
        find: /^decode-named-character-reference$/,
        replacement: resolveDecodeEntry(),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 1459,
    strictPort: true,
    fs: {
      allow: [
        benchRoot,
        appRoot,
        repoRoot,
        realOrSelf(path.join(appRoot, 'node_modules')),
        realOrSelf(path.join(repoRoot, 'node_modules')),
      ],
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    // 基准目录自己的输出，不进入应用的 dist。
    outDir: path.join(benchRoot, 'dist'),
  },
})
