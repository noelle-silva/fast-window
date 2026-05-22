import path from 'node:path'
import { readFile, cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url)
const PDFJS_ASSET_ROUTE = '/pdfjs/'
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm'] as const
type PdfjsAssetDir = typeof PDFJS_ASSET_DIRS[number]

function resolvePdfjsRoot(): string {
  return path.dirname(require.resolve('pdfjs-dist/package.json'))
}

function isPdfjsAssetDir(value: string | undefined): value is PdfjsAssetDir {
  return PDFJS_ASSET_DIRS.includes(value as PdfjsAssetDir)
}

function getPdfjsAssetMime(filePath: string): string {
  if (filePath.endsWith('.wasm')) return 'application/wasm'
  if (filePath.endsWith('.mjs') || filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  return 'application/octet-stream'
}

function createPdfjsAssetsPlugin(): Plugin {
  let outDir = ''

  return {
    name: 'hypercortex-pdfjs-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      const pdfjsRoot = resolvePdfjsRoot()
      server.middlewares.use(async (request, response, next) => {
        const requestPath = request.url?.split('?', 1)[0]
        if (!requestPath?.startsWith(PDFJS_ASSET_ROUTE)) {
          next()
          return
        }

        try {
          const relativePath = decodeURIComponent(requestPath.slice(PDFJS_ASSET_ROUTE.length))
          const [assetDir, ...fileSegments] = relativePath.split('/').filter(Boolean)
          if (!isPdfjsAssetDir(assetDir) || fileSegments.length === 0 || fileSegments.some(segment => segment === '..' || segment.includes('\\'))) {
            response.statusCode = 404
            response.end()
            return
          }

          const assetRoot = path.resolve(pdfjsRoot, assetDir)
          const filePath = path.resolve(assetRoot, ...fileSegments)
          if (!filePath.startsWith(`${assetRoot}${path.sep}`)) {
            response.statusCode = 404
            response.end()
            return
          }

          const data = await readFile(filePath)
          response.setHeader('Content-Type', getPdfjsAssetMime(filePath))
          response.end(data)
        } catch {
          next()
        }
      })
    },
    async writeBundle() {
      const pdfjsRoot = resolvePdfjsRoot()
      await Promise.all(PDFJS_ASSET_DIRS.map(assetDir => cp(path.join(pdfjsRoot, assetDir), path.join(outDir, 'pdfjs', assetDir), { recursive: true, force: true })))
    },
  }
}

export default defineConfig({
  clearScreen: false,
  plugins: [react(), createPdfjsAssetsPlugin()],
  server: {
    host: '127.0.0.1',
    port: 1432,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
})
