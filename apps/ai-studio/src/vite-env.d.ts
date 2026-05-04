/// <reference types="vite/client" />

declare module 'mammoth/mammoth.browser' {
  const mammoth: any
  export default mammoth
}

declare module 'katex/contrib/auto-render' {
  const renderMathInElement: any
  export default renderMathInElement
}
