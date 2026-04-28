import { readOutputImage } from './imageStore'
import { writeTextClipboard } from './textClipboard'

export async function writeText(text: string): Promise<void> {
  await writeTextClipboard(text)
}

export async function writeImage(req: { dataUrl?: string; path?: string }): Promise<void> {
  const dataUrl = req.dataUrl || (req.path ? await readOutputImage(req.path) : '')
  if (!/^data:image\//i.test(dataUrl)) throw new Error('图片剪贴板写入需要 data URL')
  throw new Error('当前 Node 后台暂不支持可靠写入 Windows 图片剪贴板，请升级 native backend executable')
}
