import { describe, expect, it } from 'vitest'
import type { FavoriteFolder, FavoriteItemRef, HyperCortexFavoritesDocV1 } from '../favorites'
import { buildFolderTree, filterFolderTree, type FolderTreeNode } from './favoritesTree'

function folder(id: string, title: string, description = ''): FavoriteFolder {
  return { id, title, description, createdAtMs: 1, updatedAtMs: 1 }
}

function folderRef(id: string, folderId: string, targetId: string): FavoriteItemRef {
  return { id, folderId, kind: 'folder', targetId, layout: { x: 0, y: 0, w: 2, h: 2 }, createdAtMs: 1, updatedAtMs: 1 }
}

// 根目录
//  ├ 工作笔记（说明：Project Alpha）
//  │   └ 会议记录（说明：空）
//  └ 生活（说明：日常）
//      └ 旅行（说明：海岛）
function fixtureDoc(): HyperCortexFavoritesDocV1 {
  return {
    version: 1,
    rootFolderId: 'root',
    folders: {
      root: folder('root', ''),
      f1: folder('f1', '工作笔记', 'Project Alpha'),
      f2: folder('f2', '会议记录'),
      f3: folder('f3', '生活', '日常'),
      f4: folder('f4', '旅行', '海岛'),
    },
    refsByFolderId: {
      root: [folderRef('r1', 'root', 'f1'), folderRef('r2', 'root', 'f3')],
      f1: [folderRef('r3', 'f1', 'f2')],
      f3: [folderRef('r4', 'f3', 'f4')],
    },
  }
}

function titles(nodes: FolderTreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: FolderTreeNode[]) => {
    for (const node of list) {
      out.push(node.title)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

describe('filterFolderTree', () => {
  const nodes = buildFolderTree(fixtureDoc())

  it('空关键词原样返回整棵树', () => {
    expect(filterFolderTree(nodes, '')).toBe(nodes)
    expect(filterFolderTree(nodes, '   ')).toBe(nodes)
    expect(titles(filterFolderTree(nodes, ''))).toEqual(['根目录', '工作笔记', '会议记录', '生活', '旅行'])
  })

  it('按名称包含匹配，命中项连同祖先保留、其余分支剪除', () => {
    const filtered = filterFolderTree(nodes, '旅行')
    expect(titles(filtered)).toEqual(['根目录', '生活', '旅行'])
    expect(filtered[0].children.map(child => child.title)).toEqual(['生活'])
    expect(filtered[0].children[0].children.map(child => child.title)).toEqual(['旅行'])
  })

  it('命中深层子项时其上级作为祖先显示', () => {
    expect(titles(filterFolderTree(nodes, '会议'))).toEqual(['根目录', '工作笔记', '会议记录'])
  })

  it('匹配范围包含说明，且忽略大小写', () => {
    expect(titles(filterFolderTree(nodes, 'alpha'))).toEqual(['根目录', '工作笔记'])
    expect(titles(filterFolderTree(nodes, '海岛'))).toEqual(['根目录', '生活', '旅行'])
  })

  it('去除关键词首尾空格', () => {
    expect(titles(filterFolderTree(nodes, '  生活  '))).toEqual(['根目录', '生活'])
  })

  it('说明为空的收藏夹仅按名称匹配', () => {
    // 「会议记录」说明为空，用只存在于他人说明里的词不会命中它。
    expect(titles(filterFolderTree(nodes, 'alpha'))).not.toContain('会议记录')
    expect(titles(filterFolderTree(nodes, '会议'))).toContain('会议记录')
  })

  it('全部不命中时返回空树', () => {
    expect(filterFolderTree(nodes, '不存在的名字')).toEqual([])
  })
})
