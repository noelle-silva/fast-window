import path from 'node:path'

export function resolvePluginDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dir = String(env.FAST_WINDOW_PLUGIN_DATA_DIR || env.FAST_WINDOW_PLUGIN_FILES_DATA_DIR || '').trim()
  if (!dir) throw new Error('FAST_WINDOW_PLUGIN_DATA_DIR 未设置')
  return path.resolve(dir)
}

export function resolvePluginOutputRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dir = String(env.FAST_WINDOW_PLUGIN_OUTPUT_DIR || '').trim()
  if (!dir) throw new Error('FAST_WINDOW_PLUGIN_OUTPUT_DIR 未设置')
  return path.resolve(dir)
}

export function assertPathInside(parent: string, child: string): void {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return
  throw new Error('路径越界')
}

export function normalizeRelativePath(input: string): string {
  const raw = String(input || '').trim()
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

export function resolvePathInData(relPath: string): string {
  const root = resolvePluginDataRoot()
  const target = path.resolve(root, normalizeRelativePath(relPath))
  assertPathInside(root, target)
  return target
}

export function resolvePathInOutput(relPath: string): string {
  const root = resolvePluginOutputRoot()
  const target = path.resolve(root, normalizeRelativePath(relPath))
  assertPathInside(root, target)
  return target
}
