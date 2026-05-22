/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FAST_WINDOW_HOST_PROFILE?: 'dev' | 'release'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
