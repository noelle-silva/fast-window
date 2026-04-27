import path from 'node:path'

export type BackendScope = 'library' | 'data'

export function resolvePluginId(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.FAST_WINDOW_PLUGIN_ID || 'hypercortex').trim() || 'hypercortex'
}

export function resolveLibraryRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dir = String(env.FAST_WINDOW_PLUGIN_LIBRARY_DIR || '').trim()
  if (!dir) throw new Error('FAST_WINDOW_PLUGIN_LIBRARY_DIR 未设置')
  return path.resolve(dir)
}

export function resolveDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dir = String(env.FAST_WINDOW_PLUGIN_DATA_DIR || env.FAST_WINDOW_PLUGIN_FILES_DATA_DIR || '').trim()
  if (!dir) throw new Error('FAST_WINDOW_PLUGIN_DATA_DIR 未设置')
  return path.resolve(dir)
}

export function resolveScopeRoot(scope: BackendScope, env: NodeJS.ProcessEnv = process.env): string {
  if (scope === 'library') return resolveLibraryRoot(env)
  if (scope === 'data') return resolveDataRoot(env)
  throw new Error(`非法 scope：${String(scope)}`)
}

export function resolvePathInScope(scope: BackendScope, relPath: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const root = resolveScopeRoot(scope, env)
  const rel = normalizeRelativePath(relPath)
  const target = rel ? path.resolve(root, rel) : root
  assertPathInside(root, target)
  return target
}

export function resolveOptionalDirInScope(scope: BackendScope, relDir?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  return resolvePathInScope(scope, relDir, env)
}

export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function assertPathInside(parent: string, child: string): void {
  if (!isPathInside(parent, child)) throw new Error('路径越界')
}

function normalizeRelativePath(input: string | null | undefined): string {
  const raw = String(input ?? '').trim()
  if (!raw) return ''
  if (raw.includes('\0')) throw new Error('路径包含非法空字节')
  const unix = raw.replace(/\\/g, '/')
  if (unix.startsWith('/')) throw new Error('不允许绝对路径')
  if (/^[A-Za-z]:/.test(unix)) throw new Error('不允许 Windows 盘符路径')
  const segments: string[] = []
  for (const part of unix.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new Error('不允许路径越界')
    segments.push(part)
  }
  return segments.length ? path.join(...segments) : ''
}
