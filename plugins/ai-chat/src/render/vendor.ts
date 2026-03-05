import * as markedMod from 'marked'
import dompurifyMod from 'dompurify'
import * as katexMod from 'katex'
import * as autoRenderMod from 'katex/contrib/auto-render'
import * as mermaidMod from 'mermaid'
import katexCss from 'katex/dist/katex.min.css'
import katexAmsRegularWoff2 from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2'
import katexCaligraphicBoldWoff2 from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2'
import katexCaligraphicRegularWoff2 from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2'
import katexFrakturBoldWoff2 from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2'
import katexFrakturRegularWoff2 from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2'
import katexMainBoldWoff2 from 'katex/dist/fonts/KaTeX_Main-Bold.woff2'
import katexMainBoldItalicWoff2 from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2'
import katexMainItalicWoff2 from 'katex/dist/fonts/KaTeX_Main-Italic.woff2'
import katexMainRegularWoff2 from 'katex/dist/fonts/KaTeX_Main-Regular.woff2'
import katexMathBoldItalicWoff2 from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2'
import katexMathItalicWoff2 from 'katex/dist/fonts/KaTeX_Math-Italic.woff2'
import katexSansSerifBoldWoff2 from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2'
import katexSansSerifItalicWoff2 from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2'
import katexSansSerifRegularWoff2 from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2'
import katexScriptRegularWoff2 from 'katex/dist/fonts/KaTeX_Script-Regular.woff2'
import katexSize1RegularWoff2 from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2'
import katexSize2RegularWoff2 from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2'
import katexSize3RegularWoff2 from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2'
import katexSize4RegularWoff2 from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2'
import katexTypewriterRegularWoff2 from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2'

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

function inlineKatexFonts(cssText: string) {
  // 插件运行在 sandbox iframe 的 srcDoc 中，CSS 里的相对路径 fonts/*.woff2 无法加载。
  // 这里把 KaTeX 的 woff2 字体内联成 data URL，避免符号尺寸/字形退化。
  const woff2ByName: Record<string, string> = {
    'KaTeX_AMS-Regular.woff2': String(katexAmsRegularWoff2 || ''),
    'KaTeX_Caligraphic-Bold.woff2': String(katexCaligraphicBoldWoff2 || ''),
    'KaTeX_Caligraphic-Regular.woff2': String(katexCaligraphicRegularWoff2 || ''),
    'KaTeX_Fraktur-Bold.woff2': String(katexFrakturBoldWoff2 || ''),
    'KaTeX_Fraktur-Regular.woff2': String(katexFrakturRegularWoff2 || ''),
    'KaTeX_Main-Bold.woff2': String(katexMainBoldWoff2 || ''),
    'KaTeX_Main-BoldItalic.woff2': String(katexMainBoldItalicWoff2 || ''),
    'KaTeX_Main-Italic.woff2': String(katexMainItalicWoff2 || ''),
    'KaTeX_Main-Regular.woff2': String(katexMainRegularWoff2 || ''),
    'KaTeX_Math-BoldItalic.woff2': String(katexMathBoldItalicWoff2 || ''),
    'KaTeX_Math-Italic.woff2': String(katexMathItalicWoff2 || ''),
    'KaTeX_SansSerif-Bold.woff2': String(katexSansSerifBoldWoff2 || ''),
    'KaTeX_SansSerif-Italic.woff2': String(katexSansSerifItalicWoff2 || ''),
    'KaTeX_SansSerif-Regular.woff2': String(katexSansSerifRegularWoff2 || ''),
    'KaTeX_Script-Regular.woff2': String(katexScriptRegularWoff2 || ''),
    'KaTeX_Size1-Regular.woff2': String(katexSize1RegularWoff2 || ''),
    'KaTeX_Size2-Regular.woff2': String(katexSize2RegularWoff2 || ''),
    'KaTeX_Size3-Regular.woff2': String(katexSize3RegularWoff2 || ''),
    'KaTeX_Size4-Regular.woff2': String(katexSize4RegularWoff2 || ''),
    'KaTeX_Typewriter-Regular.woff2': String(katexTypewriterRegularWoff2 || ''),
  }

  let out = String(cssText || '')

  // 去掉 woff/ttf fallback，避免无意义的相对路径请求。
  out = out.replace(
    /,url\((['"]?)fonts\/([A-Za-z0-9_-]+)\.woff\1\) format\("woff"\),url\((['"]?)fonts\/\2\.ttf\3\) format\("truetype"\)/g,
    '',
  )

  // 把 woff2 相对路径替换成 data URL。
  out = out.replace(/url\((['"]?)fonts\/([A-Za-z0-9_-]+\.woff2)\1\)/g, (m, _q, name) => {
    const u = woff2ByName[String(name || '')]
    return u ? `url(${u})` : m
  })

  return out
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

ensureStyle('katex-css', inlineKatexFonts(String(katexCss || '')))
attachGlobals()
