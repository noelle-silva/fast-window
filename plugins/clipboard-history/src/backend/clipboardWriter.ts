import { spawn } from 'node:child_process'
import { readOutputImage } from './imageStore'

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `PowerShell exited with ${code}`))
    })
  })
}

export async function writeText(text: string): Promise<void> {
  const payload = Buffer.from(String(text || ''), 'utf16le').toString('base64')
  await runPowerShell(`[Console]::InputEncoding=[Text.Encoding]::Unicode; [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${payload}')) | Set-Clipboard`)
}

export async function writeImage(req: { dataUrl?: string; path?: string }): Promise<void> {
  const dataUrl = req.dataUrl || (req.path ? await readOutputImage(req.path) : '')
  if (!/^data:image\//i.test(dataUrl)) throw new Error('图片剪贴板写入需要 data URL')
  throw new Error('当前 Node 后台暂不支持可靠写入 Windows 图片剪贴板，请升级 native backend executable')
}
