import { sanitizeHtml as sanitizeRenderHtml, sanitizeSvg as sanitizeRenderSvg, type RenderSafetyPolicy } from '../../../htmlSanitizer'

/* ------------------------------------------------------------------ */
/*  HTML 消毒（复用宿主共享的安全设施）                                   */
/* ------------------------------------------------------------------ */

export function sanitizeHtml(html: unknown, policy?: RenderSafetyPolicy): string {
  return sanitizeRenderHtml(html, policy)
}

export function sanitizeSvg(svg: unknown, policy?: RenderSafetyPolicy): string {
  return sanitizeRenderSvg(svg, policy)
}
