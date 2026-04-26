import { spawn } from 'node:child_process'

export function openUrl(url: string) {
  const target = String(url || '').trim()
  if (!/^https?:\/\//i.test(target)) throw new Error('URL 不合法')

  const platform = process.platform
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  if (platform === 'darwin') {
    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref()
}
