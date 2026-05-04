export function mimeFromDataUrl(dataUrl: string): string {
  const m = /^data:([^;]+);base64,/.exec(String(dataUrl || '').trim())
  return m ? String(m[1] || '').toLowerCase() : ''
}

export function extFromMime(mime: string): string {
  const m = String(mime || '').toLowerCase()
  if (m === 'image/jpeg') return 'jpg'
  if (m === 'image/png') return 'png'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/gif') return 'gif'
  if (m === 'image/svg+xml') return 'svg'

  if (m === 'audio/mpeg') return 'mp3'
  if (m === 'audio/wav') return 'wav'
  if (m === 'audio/ogg') return 'ogg'
  if (m === 'audio/flac') return 'flac'
  if (m === 'audio/aac') return 'aac'
  if (m === 'audio/mp4') return 'm4a'

  if (m === 'video/mp4') return 'mp4'
  if (m === 'video/x-m4v') return 'm4v'
  if (m === 'video/webm') return 'webm'
  if (m === 'video/quicktime') return 'mov'
  if (m === 'video/ogg') return 'ogv'

  if (m === 'application/pdf') return 'pdf'
  if (m === 'text/plain') return 'txt'
  if (m === 'text/csv') return 'csv'
  if (m === 'application/zip') return 'zip'
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx'
  return ''
}

export function mimeFromExt(ext: string): string {
  const e = String(ext || '').toLowerCase().replace(/^\./, '').trim()
  if (e === 'jpg') return 'image/jpeg'
  if (e === 'png') return 'image/png'
  if (e === 'webp') return 'image/webp'
  if (e === 'gif') return 'image/gif'
  if (e === 'svg') return 'image/svg+xml'

  if (e === 'mp3') return 'audio/mpeg'
  if (e === 'wav') return 'audio/wav'
  if (e === 'ogg') return 'audio/ogg'
  if (e === 'flac') return 'audio/flac'
  if (e === 'aac') return 'audio/aac'
  if (e === 'm4a') return 'audio/mp4'

  if (e === 'mp4') return 'video/mp4'
  if (e === 'm4v') return 'video/x-m4v'
  if (e === 'webm') return 'video/webm'
  if (e === 'mov') return 'video/quicktime'
  if (e === 'ogv') return 'video/ogg'

  if (e === 'pdf') return 'application/pdf'
  if (e === 'txt') return 'text/plain'
  if (e === 'csv') return 'text/csv'
  if (e === 'zip') return 'application/zip'
  if (e === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (e === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (e === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  return ''
}

export function kindFromMime(mime: string): string {
  const m = String(mime || '').toLowerCase().trim()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  return 'document'
}

export const ACCEPTED_FILE_EXTENSIONS = [
  'jpg', 'png', 'webp', 'gif', 'svg', 'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'mp4', 'm4v', 'webm', 'mov', 'ogv', 'pdf', 'txt', 'csv', 'zip', 'docx', 'xlsx', 'pptx',
] as const

export function acceptString(): string {
  return ACCEPTED_FILE_EXTENSIONS.map(ext => `.${ext}`).join(',')
}
