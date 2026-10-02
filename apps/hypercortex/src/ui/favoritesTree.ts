import type { HyperCortexFavoritesDocV1 } from '../favorites'
import { getFolderById, getFolderRefs } from '../favorites'

// 收藏夹文件夹树的统一构建：把「文件夹 + 文件夹引用」的图结构展开为可供选择器渲染的树。
// 「收藏到…」与「移动到…」两个选择器共用同一份树，保证目标集合的呈现完全一致。

export type FolderTreeNode = {
  key: string
  id: string
  title: string
  children: FolderTreeNode[]
}

export function folderDisplayTitle(folderId: string, title?: string): string {
  if (String(folderId || '').trim() === 'root') return '根目录'
  return String(title || '').trim() || '未命名收藏夹'
}

export function buildFolderTree(doc: HyperCortexFavoritesDocV1): FolderTreeNode[] {
  const walk = (folderId: string, path: string[]): FolderTreeNode | null => {
    const id = String(folderId || '').trim()
    if (!id || path.includes(id)) return null
    const folder = getFolderById(doc, id)
    if (!folder) return null
    const currentPath = [...path, id]
    const children: FolderTreeNode[] = []
    for (const ref of getFolderRefs(doc, id)) {
      const child = walk(ref.targetId, currentPath)
      if (child) children.push(child)
    }
    return {
      key: currentPath.join('/'),
      id,
      title: folderDisplayTitle(id, folder.title),
      children,
    }
  }
  const root = walk(doc.rootFolderId || 'root', [])
  return root ? [root] : []
}

export function collectTreeKeys(nodes: FolderTreeNode[]): string[] {
  const out: string[] = []
  for (const node of nodes) {
    out.push(node.key)
    out.push(...collectTreeKeys(node.children))
  }
  return out
}

export function collectUniqueFolderIds(nodes: FolderTreeNode[]): string[] {
  const set = new Set<string>()
  const walk = (list: FolderTreeNode[]) => {
    for (const n of list) {
      set.add(n.id)
      walk(n.children)
    }
  }
  walk(nodes)
  return [...set]
}
