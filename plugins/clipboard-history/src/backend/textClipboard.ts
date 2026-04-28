import { execFile } from 'node:child_process'
import path from 'node:path'

function windowsClipboardBinaryPath() {
  return path.resolve(__dirname, '../fallbacks/windows/clipboard_x86_64.exe')
}

function execClipboard(args: string[], options: { input?: string } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(windowsClipboardBinaryPath(), args, {
      encoding: 'buffer',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(Buffer.isBuffer(stderr) && stderr.length ? stderr.toString('utf8') : error.message))
        return
      }
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || ''))
    })
    if (options.input !== undefined) child.stdin?.end(options.input, 'utf8')
  })
}

export async function readTextClipboard(): Promise<string> {
  const output = await execClipboard(['--paste'])
  return output.toString('utf8')
}

export async function writeTextClipboard(text: string): Promise<void> {
  await execClipboard(['--copy'], { input: String(text || '') })
}
