import { sanitizeHtml } from './htmlSanitizer'

/** docx 等文档预览的 HTML 消毒：复用通用渲染安全设施（baseline 策略）。 */
export function sanitizeDocumentHtml(html: unknown): string {
  return sanitizeHtml(html, 'baseline')
}
