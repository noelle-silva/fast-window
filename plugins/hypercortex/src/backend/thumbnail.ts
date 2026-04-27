import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { VaultScope } from '../core'
import { resolvePathInScope } from './paths'

export type ThumbnailProvider = {
  getThumbnail: (req: { scope: VaultScope; path: string; width?: number | null; height?: number | null }) => Promise<string>
}

export function createThumbnailProvider(): ThumbnailProvider {
  return {
    getThumbnail: req => createVideoThumbnail(req),
  }
}

async function createVideoThumbnail(req: { scope: VaultScope; path: string; width?: number | null; height?: number | null }): Promise<string> {
  const source = resolvePathInScope(req.scope, req.path)
  const width = Number.isInteger(req.width) && Number(req.width) > 0 ? Number(req.width) : 320
  const output = path.join(os.tmpdir(), `hypercortex-thumb-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`)
  const vf = `thumbnail,scale=${width}:-1`
  await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-frames:v', '1', '-vf', vf, output])
  try {
    const bytes = await fs.readFile(output)
    return `data:image/jpeg;base64,${bytes.toString('base64')}`
  } finally {
    await fs.rm(output, { force: true }).catch(() => {})
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += String(chunk || '')
    })
    child.on('error', error => reject(new Error(`视频缩略图依赖 ffmpeg 不可用：${error.message}`)))
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`视频缩略图生成失败：${stderr.trim() || `ffmpeg exited ${code}`}`))
    })
  })
}
