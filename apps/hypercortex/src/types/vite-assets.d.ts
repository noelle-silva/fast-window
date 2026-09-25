declare module '*?raw' {
  const value: string
  export default value
}

declare module '*.woff2' {
  const value: string
  export default value
}

declare module 'katex/contrib/auto-render'

interface ImportMetaEnv {
  readonly BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
