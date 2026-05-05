export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; dataBytes: Uint8Array }

export function buildMultipartFormDataBytes(boundary: string, parts: MultipartPart[]) {
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'))
    if ('filename' in part) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`, 'utf8'))
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n\r\n`, 'utf8'))
      chunks.push(Buffer.from(part.dataBytes))
      chunks.push(Buffer.from('\r\n', 'utf8'))
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`, 'utf8'))
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  return Buffer.concat(chunks)
}
