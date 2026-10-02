// 渲染测试共享的全局装配：把渲染引擎依赖的全局对象装到当前 DOM 环境。
// 与 src/render/vendor.ts 在浏览器里的接线同源，这里只是测试环境的等价装配。
// 常规渲染测试与性能测试台共用本模块，避免重复实现。
export type RenderGlobals = {
  marked: any
  katex: any
  DOMPurify: any
}

export async function installRenderGlobals(): Promise<RenderGlobals> {
  const w = globalThis as any
  const markedMod: any = await import('marked')
  const dompurifyMod: any = await import('dompurify')
  const katexMod: any = await import('katex')

  const marked = markedMod.marked || markedMod.default
  const katex = katexMod.default
  const dompurifyFactory = dompurifyMod.default
  const DOMPurify = typeof dompurifyFactory === 'function' ? dompurifyFactory(w) : dompurifyFactory

  w.marked = marked
  w.katex = katex
  w.DOMPurify = DOMPurify
  return { marked, katex, DOMPurify }
}
