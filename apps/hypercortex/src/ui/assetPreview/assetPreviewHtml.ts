import { sanitizeDocumentHtml } from '../../documentHtml'

export function sanitizeAssetPreviewHtml(html: unknown): string {
  return sanitizeDocumentHtml(html)
}
