import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

function resolveFfmpegBinary() {
  const ffmpegPath = require('ffmpeg-static')
  if (!ffmpegPath || typeof ffmpegPath !== 'string') throw new Error('ffmpeg-static 未提供可用的 ffmpeg 二进制路径')
  return ffmpegPath
}

function ensureFfmpegInstalled() {
  const source = resolveFfmpegBinary()
  if (existsSync(source)) return source

  const installScript = require.resolve('ffmpeg-static/install.js')
  execFileSync(process.execPath, [installScript], {
    cwd: path.dirname(installScript),
    stdio: 'inherit',
    env: process.env,
  })

  const installed = resolveFfmpegBinary()
  if (!existsSync(installed)) throw new Error(`ffmpeg-static 安装完成后仍未找到二进制文件：${installed}`)
  return installed
}

async function copyAssets(target) {
  await fs.rm(path.join(target, 'assets'), { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  await fs.cp(path.join(appDir, 'assets'), path.join(target, 'assets'), { recursive: true })
}

async function copyFfmpeg(target) {
  const source = ensureFfmpegInstalled()
  const binDir = path.join(target, 'bin')
  const destination = path.join(binDir, ffmpegBinaryName)
  await fs.rm(binDir, { recursive: true, force: true })
  await fs.mkdir(binDir, { recursive: true })
  await fs.copyFile(source, destination)
  if (process.platform !== 'win32') await fs.chmod(destination, 0o755)
}

async function copyResources(target) {
  await copyAssets(target)
  await copyFfmpeg(target)
}

await copyResources(path.join(appDir, 'src-tauri', 'target', 'debug'))
await copyResources(path.join(appDir, 'src-tauri', 'target', 'resources'))
