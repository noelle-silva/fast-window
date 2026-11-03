import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// ============================================================================
// 后台包自检：防止 Worker 分块重新混入页面环境实现
//
// decode-named-character-reference 的 browser 条件入口会在模块顶层调用
// document.createElement('i')。Worker 里没有 document，加载即崩。
// Vite 的 Worker 构建不继承顶层 plugins，所以必须由配置显式修正；
// 本脚本在构建后直接扫描产物，避免配置回退后直到运行期才暴露。
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const assetsDir = path.join(appDir, 'dist', 'assets')

const WORKER_CHUNK_RE = /\.worker-[^/\\]+\.js$/
const DOM_IMPLEMENTATION_RE = /document\.createElement\(\s*['"]i['"]\s*\)/

async function main() {
  let entries
  try {
    entries = await fs.readdir(assetsDir)
  } catch {
    throw new Error(`构建产物目录不存在：${assetsDir}（请先执行 vite build）`)
  }

  const workerChunks = entries.filter((name) => WORKER_CHUNK_RE.test(name))
  if (!workerChunks.length) {
    throw new Error(`未在 ${assetsDir} 找到后台分块，自检无法确认 Worker 产物`)
  }

  const offenders = []
  for (const name of workerChunks) {
    const source = await fs.readFile(path.join(assetsDir, name), 'utf8')
    if (DOM_IMPLEMENTATION_RE.test(source)) offenders.push(name)
  }

  if (offenders.length) {
    for (const name of offenders) {
      process.stderr.write(`[worker-bundle-check] 后台分块包含 DOM 实现：${name}\n`)
    }
    throw new Error('后台包混入了 document.createElement("i")，Worker 将在无 DOM 环境启动失败')
  }

  process.stdout.write(
    `[worker-bundle-check] 通过：${workerChunks.length} 个后台分块均未包含 document.createElement("i")\n`,
  )
  for (const name of workerChunks) {
    process.stdout.write(`  - ${name}\n`)
  }
}

main().catch((error) => {
  process.stderr.write(`[worker-bundle-check] 失败：${String(error?.message || error)}\n`)
  process.exit(1)
})
