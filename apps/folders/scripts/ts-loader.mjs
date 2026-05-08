import { transformSync } from 'esbuild'
import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs']

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
    for (const extension of RESOLVABLE_EXTENSIONS) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) return { shortCircuit: true, url: candidate.href }
    }
  }

  if ((specifier.endsWith('.ts') || specifier.endsWith('.tsx')) && !specifier.startsWith('file:')) {
    return { shortCircuit: true, url: new URL(specifier, context.parentURL).href }
  }

  return nextResolve(specifier, context)
}

function transformTs(url) {
  const filePath = fileURLToPath(url)
  const source = readFileSync(filePath, 'utf8')
  const loader = extname(filePath) === '.tsx' ? 'tsx' : 'ts'
  return transformSync(source, {
    loader,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: 'inline',
    sourcefile: filePath,
  }).code
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    return { format: 'module', shortCircuit: true, source: transformTs(url) }
  }
  return nextLoad(url, context)
}
