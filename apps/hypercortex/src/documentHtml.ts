import { createMarkdownRenderEngine } from './render/engine'

let documentRenderEngine: ReturnType<typeof createMarkdownRenderEngine> | null = null

export function sanitizeDocumentHtml(html: unknown): string {
  if (!documentRenderEngine) {
    documentRenderEngine = createMarkdownRenderEngine({ scope: 'library' })
  }
  return documentRenderEngine.sanitizeHtml(html, 'baseline')
}
