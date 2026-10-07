import { describe, expect, it } from 'vitest'
import { compressImageDataUrl } from './imageCompression'

describe('compressImageDataUrl', () => {
  it('非图片 data URL 原样返回', async () => {
    const raw = 'https://example.com/a.png'
    await expect(compressImageDataUrl(raw)).resolves.toBe(raw)
  })

  it('无法解码的图片数据 URL 安全退回原值', async () => {
    const raw = 'data:image/png;base64,not-valid-base64'
    await expect(compressImageDataUrl(raw)).resolves.toBe(raw)
  })
})
