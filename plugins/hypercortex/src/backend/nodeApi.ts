import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Api, VaultScope } from '../core'
import { ASSETS_DIR, NOTES_DIR } from '../core'
import { mimeFromExt } from '../assetFileTypes'
import { TRASH_DIR } from '../trash'
import { assertPathInside, resolveDataRoot, resolveLibraryRoot, resolvePathInScope, resolveScopeRoot, type BackendScope } from './paths'

export type FileEntry = {
  name: string
  isDirectory: boolean
  isFile: boolean
  size: number
  modifiedMs: number
}

function scopeOf(scope: VaultScope): BackendScope {
  if (scope !== 'library' && scope !== 'data') throw new Error(`非法 scope：${String(scope)}`)
  return scope
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true).catch(() => false)
}

async function ensureParent(target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
}

function assertSafeDeleteTree(scope: BackendScope, target: string) {
  const root = resolveScopeRoot(scope)
  assertPathInside(root, target)
  if (path.resolve(target) === path.resolve(root)) throw new Error('禁止删除 scope 根目录')
  if (scope === 'library') {
    for (const rootDir of [NOTES_DIR, ASSETS_DIR, TRASH_DIR]) {
      const protectedPath = resolvePathInScope(scope, rootDir)
      if (path.resolve(target) === path.resolve(protectedPath)) throw new Error(`禁止删除 ${rootDir} 根目录`)
    }
  }
}

function dataUrlForFile(filePath: string, bytes: Buffer): string {
  const mime = mimeFromExt(path.extname(filePath)) || 'application/octet-stream'
  return `data:${mime};base64,${bytes.toString('base64')}`
}

async function openSystemDir(dir: string): Promise<void> {
  const platform = process.platform
  if (platform === 'win32') spawn('cmd', ['/c', 'start', '', dir], { detached: true, stdio: 'ignore' }).unref()
  else if (platform === 'darwin') spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref()
  else spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref()
}

export function createBackendApi(): Api {
  return {
    __meta: { runtime: 'background' },
    ui: {
      showToast: () => {},
      back: () => {},
      startDragging: () => {},
    },
    clipboard: {
      writeText: async () => {
        throw new Error('剪贴板不属于 HyperCortex 后台能力')
      },
    },
    files: {
      async getLibraryDir() {
        return resolveLibraryRoot()
      },
      async pickLibraryDir() {
        throw new Error('pickLibraryDir 不属于 HyperCortex 后台能力')
      },
      async openDir(dir: string) {
        const target = path.resolve(String(dir || '').trim())
        const libraryRoot = resolveLibraryRoot()
        const dataRoot = resolveDataRoot()
        if (!target || (!path.isAbsolute(target))) throw new Error('dir 必须是绝对路径')
        if (!isInsideAny(target, [libraryRoot, dataRoot])) throw new Error('只能打开 HyperCortex library/data 范围内目录')
        await fs.mkdir(target, { recursive: true })
        await openSystemDir(target)
      },
      async listDir(req) {
        const dir = resolvePathInScope(scopeOf(req.scope), req.dir)
        await fs.mkdir(dir, { recursive: true })
        const entries = await fs.readdir(dir, { withFileTypes: true })
        const out: FileEntry[] = []
        for (const ent of entries) {
          const full = path.join(dir, ent.name)
          const stat = await fs.stat(full).catch(() => null)
          out.push({
            name: ent.name,
            isDirectory: ent.isDirectory(),
            isFile: ent.isFile(),
            size: stat?.size || 0,
            modifiedMs: stat?.mtimeMs || 0,
          })
        }
        return out
      },
      async readText(req) {
        return fs.readFile(resolvePathInScope(scopeOf(req.scope), req.path), 'utf8')
      },
      async writeText(req) {
        const target = resolvePathInScope(scopeOf(req.scope), req.path)
        await ensureParent(target)
        if (req.overwrite === false && await exists(target)) throw new Error('目标文件已存在')
        await fs.writeFile(target, String(req.text ?? ''), 'utf8')
        return req.path
      },
      async readBase64(req) {
        const target = resolvePathInScope(scopeOf(req.scope), req.path)
        return dataUrlForFile(target, await fs.readFile(target))
      },
      async writeBase64(req) {
        const target = resolvePathInScope(scopeOf(req.scope), req.path)
        await ensureParent(target)
        if (req.overwrite === false && await exists(target)) throw new Error('目标文件已存在')
        const payload = base64PayloadFromDataUrl(req.dataUrlOrBase64)
        await fs.writeFile(target, Buffer.from(payload, 'base64'))
        return req.path
      },
      async rename(req) {
        const scope = scopeOf(req.scope)
        const from = resolvePathInScope(scope, req.from)
        const to = resolvePathInScope(scope, req.to)
        await ensureParent(to)
        if (req.overwrite === false && await exists(to)) throw new Error('目标路径已存在')
        await fs.rename(from, to)
      },
      async delete(req) {
        const target = resolvePathInScope(scopeOf(req.scope), req.path)
        await fs.rm(target, { force: true })
      },
      async deleteTree(req) {
        const scope = scopeOf(req.scope)
        const target = resolvePathInScope(scope, req.path)
        assertSafeDeleteTree(scope, target)
        await fs.rm(target, { recursive: true, force: true })
      },
      async pickImages() {
        throw new Error('pickImages 不属于 HyperCortex 后台能力')
      },
    },
  }
}

function base64PayloadFromDataUrl(dataUrlOrBase64: string): string {
  const input = String(dataUrlOrBase64 || '').trim()
  const payload = input.startsWith('data:') ? input.slice(input.indexOf(',') + 1) : input
  if (!payload || /[^A-Za-z0-9+/=\r\n\s]/.test(payload)) throw new Error('base64 数据无效')
  return payload.replace(/[\r\n\s]/g, '')
}

function isInsideAny(target: string, roots: string[]): boolean {
  return roots.some(root => {
    try {
      assertPathInside(root, target)
      return true
    } catch {
      return false
    }
  })
}
