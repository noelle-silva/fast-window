import * as markedMod from 'marked'
import dompurifyMod from 'dompurify'
import * as katexMod from 'katex'
import * as autoRenderMod from 'katex/contrib/auto-render'
import * as mermaidMod from 'mermaid'
import katexCss from 'katex/dist/katex.min.css'

function pickExport(mod: any, keys: string[]) {
  if (!mod) return null
  for (const k of keys) {
    if (mod && mod[k] != null) return mod[k]
  }
  return mod
}

function ensureStyle(id: string, cssText: string) {
  if (!cssText) return
  if (document.getElementById(id)) return
  const el = document.createElement('style')
  el.id = id
  el.textContent = cssText
  document.head.appendChild(el)
}

function attachGlobals() {
  const w = window as any

  const marked = pickExport(markedMod as any, ['marked', 'default'])
  if (marked) w.marked = marked

  const katex = pickExport(katexMod as any, ['default'])
  if (katex) w.katex = katex

  const renderMathInElement = pickExport(autoRenderMod as any, ['renderMathInElement', 'default'])
  if (renderMathInElement) w.renderMathInElement = renderMathInElement

  const mermaid = pickExport(mermaidMod as any, ['default'])
  if (mermaid) w.mermaid = mermaid

  const dompurifyFactory = pickExport(dompurifyMod as any, ['default'])
  try {
    const DOMPurify = typeof dompurifyFactory === 'function' ? dompurifyFactory(w) : dompurifyFactory
    if (DOMPurify) w.DOMPurify = DOMPurify
  } catch {
    // ignore
  }
}

ensureStyle('katex-css', String(katexCss || ''))
attachGlobals()

