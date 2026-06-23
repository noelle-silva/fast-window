import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const runtimeDirName = 'selection-runtime'

async function copySelectionRuntime(target) {
  const runtimeDir = path.join(target, runtimeDirName)
  const nodeDir = path.join(runtimeDir, 'node')
  const modulesDir = path.join(runtimeDir, 'node_modules')
  const selectionHookDir = path.dirname(require.resolve('selection-hook', { paths: [appDir] }))
  const nodeGypBuildDir = path.dirname(require.resolve('node-gyp-build', { paths: [selectionHookDir] }))

  if (process.platform !== 'win32') {
    throw new Error('Quick Bar 取词运行资源当前只支持 Windows 发布包')
  }

  await fs.rm(runtimeDir, { recursive: true, force: true })
  await fs.mkdir(nodeDir, { recursive: true })
  await fs.copyFile(process.execPath, path.join(nodeDir, 'node.exe'))
  await fs.copyFile(path.join(__dirname, 'selection-hook-worker.cjs'), path.join(runtimeDir, 'selection-hook-worker.cjs'))
  await copySelectionHookPackage(selectionHookDir, path.join(modulesDir, 'selection-hook'))
  await fs.cp(nodeGypBuildDir, path.join(modulesDir, 'node-gyp-build'), { recursive: true })
}

async function copySelectionHookPackage(sourceDir, targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.mkdir(targetDir, { recursive: true })
  for (const entry of ['index.js', 'index.d.ts', 'package.json', 'LICENSE', 'README.md', 'README.zh-CN.md']) {
    await fs.copyFile(path.join(sourceDir, entry), path.join(targetDir, entry))
  }
  await fs.cp(path.join(sourceDir, 'prebuilds', 'win32-x64'), path.join(targetDir, 'prebuilds', 'win32-x64'), { recursive: true })
}

async function copyAssets(target) {
  await fs.rm(path.join(target, 'assets'), { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  await fs.cp(path.join(appDir, 'assets'), path.join(target, 'assets'), { recursive: true })
}

for (const target of [
  path.join(appDir, 'src-tauri', 'target', 'debug'),
  path.join(appDir, 'src-tauri', 'target', 'resources'),
]) {
  await copyAssets(target)
  await copySelectionRuntime(target)
}
