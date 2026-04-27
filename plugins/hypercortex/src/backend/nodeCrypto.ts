import { createHash } from 'node:crypto'

export async function sha256HexFromDataUrlOrBase64(dataUrlOrBase64: string): Promise<string> {
  const input = String(dataUrlOrBase64 || '').trim()
  const payload = input.startsWith('data:') ? input.slice(input.indexOf(',') + 1) : input
  if (!payload || /[^A-Za-z0-9+/=\r\n\s]/.test(payload)) throw new Error('base64 数据无效')
  return createHash('sha256').update(Buffer.from(payload.replace(/[\r\n\s]/g, ''), 'base64')).digest('hex')
}
