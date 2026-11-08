import { describe, expect, it } from 'vitest'
import type { PromptFolder, PromptFolderLibrary } from './promptLibrary'
import { canPlacePromptEntry, planPromptPlacementMove } from './promptLibraryPlacement'

function folder(id: string, overrides: Partial<PromptFolder> = {}): PromptFolder {
  return {
    id,
    name: id,
    folderIds: [],
    promptIds: [],
    entryOrder: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

// a
// ├── b
// │   └── c（含 p2）
// └── d
// p1 收在 a 里；p3 未被任何收藏夹收录，直属根层级。
const tree: PromptFolderLibrary = {
  rootFolderIds: ['a', 'd'],
  rootEntryOrder: ['folder:a', 'folder:d', 'prompt:p3'],
  folders: [
    folder('a', { folderIds: ['b'], promptIds: ['p1'] }),
    folder('b', { folderIds: ['c'] }),
    folder('c', { promptIds: ['p2'] }),
    folder('d'),
  ],
}

const prompt = { kind: 'prompt' as const, id: 'p1' }
const folderA = { kind: 'folder' as const, id: 'a' }

describe('canPlacePromptEntry', () => {
  it('同层不可放置', () => {
    expect(canPlacePromptEntry({ library: tree, payload: prompt, fromFolderId: 'a', toFolderId: 'a' })).toBe(false)
    expect(canPlacePromptEntry({ library: tree, payload: folderA, fromFolderId: '', toFolderId: '' })).toBe(false)
  })

  it('提示词可以从收藏夹摘下回到根层级', () => {
    expect(canPlacePromptEntry({ library: tree, payload: prompt, fromFolderId: 'a', toFolderId: '' })).toBe(true)
  })

  it('根层级的复制目标不存在：已经被收藏夹收走就不能再放进同一夹', () => {
    expect(canPlacePromptEntry({ library: tree, payload: prompt, fromFolderId: '', toFolderId: 'a' })).toBe(false)
    expect(canPlacePromptEntry({ library: tree, payload: prompt, fromFolderId: 'a', toFolderId: 'd' })).toBe(true)
  })

  it('未归属的提示词可以收进任意收藏夹', () => {
    const unfiled = { kind: 'prompt' as const, id: 'p3' }
    expect(canPlacePromptEntry({ library: tree, payload: unfiled, fromFolderId: '', toFolderId: 'd' })).toBe(true)
  })

  it('收藏夹不能放进自己或自己的子树', () => {
    expect(canPlacePromptEntry({ library: tree, payload: folderA, fromFolderId: '', toFolderId: 'a' })).toBe(false)
    expect(canPlacePromptEntry({ library: tree, payload: folderA, fromFolderId: '', toFolderId: 'c' })).toBe(false)
    expect(canPlacePromptEntry({ library: tree, payload: folderA, fromFolderId: '', toFolderId: 'd' })).toBe(true)
  })

  it('收藏夹不能放进已经收录它的父级', () => {
    const child = { kind: 'folder' as const, id: 'c' }
    expect(canPlacePromptEntry({ library: tree, payload: child, fromFolderId: '', toFolderId: 'b' })).toBe(false)
  })

  it('目标层不存在时不可放置', () => {
    expect(canPlacePromptEntry({ library: tree, payload: prompt, fromFolderId: '', toFolderId: 'missing' })).toBe(false)
  })
})

describe('planPromptPlacementMove', () => {
  it('提示词换夹给出提示词移动动作', () => {
    expect(planPromptPlacementMove({ library: tree, payload: prompt, fromFolderId: 'a', toFolderId: 'd' })).toEqual({
      actionName: 'movePromptToFolder',
      id: 'p1',
      fromFolderId: 'a',
      toFolderId: 'd',
    })
  })

  it('收藏夹换父级给出收藏夹移动动作', () => {
    expect(planPromptPlacementMove({ library: tree, payload: folderA, fromFolderId: '', toFolderId: 'd' })).toEqual({
      actionName: 'movePromptFolder',
      id: 'a',
      fromFolderId: '',
      toFolderId: 'd',
    })
  })

  it('不可放置时没有动作', () => {
    expect(planPromptPlacementMove({ library: tree, payload: folderA, fromFolderId: '', toFolderId: 'c' })).toBeNull()
  })
})
