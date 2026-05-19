import { createMarkdownRenderEngine } from '../../render/engine'

let assetPreviewRenderEngine: ReturnType<typeof createMarkdownRenderEngine> | null = null

export function sanitizeAssetPreviewHtml(html: unknown): string {
  if (!assetPreviewRenderEngine) {
    assetPreviewRenderEngine = createMarkdownRenderEngine({ scope: 'library' })
  }
  return assetPreviewRenderEngine.sanitizeHtml(html, 'baseline')
}
