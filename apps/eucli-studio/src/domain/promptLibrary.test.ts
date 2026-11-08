import { describe, expect, it } from 'vitest'
import {
  applyPromptEntryOrder,
  collectPromptFolderSubtreeIds,
  completeFolderEntryOrder,
  completeRootEntryOrder,
  normalizePromptFolderLibrary,
  normalizePromptLibrary,
  rootLayerPromptIds,
  promptFolderParentId,
  promptLayerKeys,
  resolveActiveOwnerId,
  resolvePromptFolderLayer,
  type PromptFolderLibrary,
  type PromptLibrary,
} from './promptLibrary'

const prompts: PromptLibrary = {
  prompts: [
    { id: 'p1', name: '短句', content: '多用短句', description: '', createdAt: '', updatedAt: '' },
    { id: 'p2', name: '事实', content: '只报事实', description: '', createdAt: '', updatedAt: '' },
    { id: 'p3', name: '清单', content: '用清单回答', description: '', createdAt: '', updatedAt: '' },
  ],
}

const folders: PromptFolderLibrary = {
  rootFolderIds: ['work', 'life'],
  rootEntryOrder: ['folder:work', 'prompt:p1', 'folder:life', 'prompt:p2', 'prompt:p3'],
  folders: [
    {
      id: 'work',
      name: '工作',
      folderIds: ['backend'],
      promptIds: ['p1', 'p2'],
      entryOrder: ['prompt:p1', 'folder:backend', 'prompt:p2'],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'backend',
      name: '后端',
      folderIds: [],
      promptIds: ['p3'],
      entryOrder: ['prompt:p3'],
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'life',
      name: '生活',
      folderIds: [],
      promptIds: [],
      entryOrder: [],
      createdAt: '',
      updatedAt: '',
    },
  ],
}

describe('resolvePromptFolderLayer', () => {
  it('根层级只显示根收藏夹与未归属的提示词', () => {
    const layer = resolvePromptFolderLayer(folders, prompts, '')
    // p1/p2 已收进「工作」，p3 已收进「后端」：根层不再显示它们。
    expect(layer.entries.map((entry) => entry.key)).toEqual(['folder:work', 'folder:life'])
    expect(layer.crumbs).toEqual([{ id: '', name: '根层级' }])
  })

  it('未归属的提示词在根层级，收进收藏夹后离开根层级', () => {
    const unfiledPrompt = { id: 'p4', name: '自由', content: '', description: '', createdAt: '', updatedAt: '' }
    const withPrompt: PromptLibrary = { prompts: [...prompts.prompts, unfiledPrompt] }
    const withOrder: PromptFolderLibrary = { ...folders, rootEntryOrder: [...folders.rootEntryOrder, 'prompt:p4'] }
    expect(resolvePromptFolderLayer(withOrder, withPrompt, '').entries.map((entry) => entry.key)).toEqual([
      'folder:work',
      'folder:life',
      'prompt:p4',
    ])
    const collected: PromptFolderLibrary = {
      ...withOrder,
      folders: withOrder.folders.map((folder) =>
        folder.id === 'life' ? { ...folder, promptIds: ['p4'], entryOrder: ['prompt:p4'] } : folder,
      ),
    }
    expect(resolvePromptFolderLayer(collected, withPrompt, '').entries.map((entry) => entry.key)).toEqual([
      'folder:work',
      'folder:life',
    ])
  })

  it('根级缺顺序时按「收藏夹在前、未归属条目在后」派生', () => {
    const fallback: PromptFolderLibrary = { ...folders, rootEntryOrder: [] }
    const layer = resolvePromptFolderLayer(fallback, prompts, '')
    expect(layer.entries.map((entry) => entry.key)).toEqual(['folder:work', 'folder:life'])
  })

  it('夹内按 entryOrder 混排子夹与条目', () => {
    const layer = resolvePromptFolderLayer(folders, prompts, 'work')
    expect(layer.entries.map((entry) => entry.key)).toEqual(['prompt:p1', 'folder:backend', 'prompt:p2'])
  })

  it('顺序里缺的条目补在末尾，不丢数据', () => {
    const stale: PromptFolderLibrary = {
      ...folders,
      folders: folders.folders.map((folder) =>
        folder.id === 'work' ? { ...folder, entryOrder: ['prompt:p1'] } : folder,
      ),
    }
    const layer = resolvePromptFolderLayer(stale, prompts, 'work')
    expect(layer.entries.map((entry) => entry.key)).toEqual(['prompt:p1', 'folder:backend', 'prompt:p2'])
  })

  it('深层路径给到完整面包屑，并能算出上一级', () => {
    const layer = resolvePromptFolderLayer(folders, prompts, 'backend')
    expect(layer.crumbs.map((crumb) => crumb.id)).toEqual(['', 'work', 'backend'])
    expect(promptFolderParentId(layer)).toBe('work')
    expect(layer.entries.map((entry) => entry.key)).toEqual(['prompt:p3'])
  })

  it('当前夹不存在时回落到根级', () => {
    const layer = resolvePromptFolderLayer(folders, prompts, 'ghost')
    expect(layer.folderId).toBe('')
    expect(layer.crumbs).toHaveLength(1)
  })

  it('模板里缺失的提示词被跳过，不产生空行', () => {
    const missing: PromptFolderLibrary = {
      rootFolderIds: ['work'],
      rootEntryOrder: ['folder:work'],
      folders: [
        {
          id: 'work',
          name: '工作',
          folderIds: [],
          promptIds: ['p1', 'gone'],
          entryOrder: ['prompt:p1', 'prompt:gone'],
          createdAt: '',
          updatedAt: '',
        },
      ],
    }
    const layer = resolvePromptFolderLayer(missing, prompts, 'work')
    expect(layer.entries.map((entry) => entry.key)).toEqual(['prompt:p1'])
  })
})

describe('promptLayerKeys', () => {
  it('给出可直接提交的混排顺序', () => {
    const layer = resolvePromptFolderLayer(folders, prompts, 'work')
    expect(promptLayerKeys(layer)).toEqual(['prompt:p1', 'folder:backend', 'prompt:p2'])
  })
})

describe('补齐提交顺序', () => {
  it('夹内顺序为空时按「收藏夹在前、条目在后」派生', () => {
    const folder = { ...folders.folders[0], entryOrder: [] }
    expect(completeFolderEntryOrder(folder)).toEqual(['folder:backend', 'prompt:p1', 'prompt:p2'])
  })

  it('夹内顺序只写了部分时，已有项保持原位，缺项补到末尾', () => {
    const folder = { ...folders.folders[0], entryOrder: ['prompt:p2'] }
    expect(completeFolderEntryOrder(folder)).toEqual(['prompt:p2', 'folder:backend', 'prompt:p1'])
  })

  it('顺序里有集合外的项或重复项时被丢弃，不提交给服务端', () => {
    const folder = { ...folders.folders[0], entryOrder: ['prompt:ghost', 'prompt:p1', 'prompt:p1'] }
    expect(completeFolderEntryOrder(folder)).toEqual(['prompt:p1', 'folder:backend', 'prompt:p2'])
  })

  it('根级顺序为空时由根收藏夹与未归属提示词派生', () => {
    const empty = { ...folders, rootEntryOrder: [] }
    expect(completeRootEntryOrder(empty, prompts)).toEqual(['folder:work', 'folder:life'])
  })

  it('根级新建收藏夹后提交的顺序只包含根层直属条目', () => {
    const order = completeRootEntryOrder({ ...folders, rootEntryOrder: [] }, prompts)
    const next = [...order, 'folder:brand-new']
    expect(next.filter((key) => key.startsWith('prompt:'))).toHaveLength(0)
    expect(next.filter((key) => key.startsWith('folder:'))).toHaveLength(3)
  })
})

describe('rootLayerPromptIds', () => {
  it('只给出没有被任何收藏夹收录的提示词', () => {
    const unfiledPrompt = { id: 'p4', name: '自由', content: '', description: '', createdAt: '', updatedAt: '' }
    const library: PromptLibrary = { prompts: [...prompts.prompts, unfiledPrompt] }
    expect(rootLayerPromptIds(folders, library)).toEqual(['p4'])
    expect(rootLayerPromptIds(folders, prompts)).toEqual([])
  })
})

describe('resolveActiveOwnerId', () => {
  const workspaceIds = ['w1', 'w2']

  it('切换作用域后旧归属不属于当前作用域时回落到第一个', () => {
    expect(resolveActiveOwnerId('workspace', 'r1', workspaceIds)).toBe('w1')
  })

  it('归属本身有效时原样返回', () => {
    expect(resolveActiveOwnerId('workspace', 'w2', workspaceIds)).toBe('w2')
  })

  it('没有可用归属时返回空串，调用方不再发请求', () => {
    expect(resolveActiveOwnerId('role', 'r1', [])).toBe('')
  })

  it('全局作用域不需要归属', () => {
    expect(resolveActiveOwnerId('global', 'w1', workspaceIds)).toBe('')
  })
})

describe('normalize', () => {
  it('丢弃空 id 条目并对列表去重', () => {
    const library = normalizePromptLibrary({
      prompts: [
        { id: 'p1', name: '一', content: '内容' },
        { id: ' p1 ', name: '重复', content: '内容' },
        { id: '', name: '空', content: '内容' },
      ],
    })
    expect(library.prompts.map((prompt) => prompt.id)).toEqual(['p1'])
  })

  it('收藏夹库缺字段时按空集合归一，并保留混排顺序', () => {
    const normalized = normalizePromptFolderLibrary({
      rootFolderIds: ['a', 'a'],
      rootEntryOrder: ['folder:a', 'prompt:p1'],
      folders: [{ id: 'a', name: '甲' }],
    })
    expect(normalized.rootFolderIds).toEqual(['a'])
    expect(normalized.rootEntryOrder).toEqual(['folder:a', 'prompt:p1'])
    expect(normalized.folders[0].folderIds).toEqual([])
    expect(normalized.folders[0].promptIds).toEqual([])
    expect(normalized.folders[0].entryOrder).toEqual([])
  })
})

describe('collectPromptFolderSubtreeIds', () => {
  it('包含自身与全部后代', () => {
    expect(collectPromptFolderSubtreeIds(folders, 'work')).toEqual(['work', 'backend'])
    expect(collectPromptFolderSubtreeIds(folders, 'life')).toEqual(['life'])
  })

  it('不存在的收藏夹返回空数组', () => {
    expect(collectPromptFolderSubtreeIds(folders, 'ghost')).toEqual([])
  })
})

describe('applyPromptEntryOrder', () => {
  it('根级只替换根顺序，夹内数据不动', () => {
    const next = applyPromptEntryOrder(folders, '', ['folder:life', 'folder:work'])
    expect(next.rootEntryOrder).toEqual(['folder:life', 'folder:work'])
    expect(next.folders).toBe(folders.folders)
  })

  it('夹内只替换目标夹的顺序', () => {
    const order = ['prompt:p2', 'folder:backend', 'prompt:p1']
    const next = applyPromptEntryOrder(folders, 'work', order)
    const work = next.folders.find((folder) => folder.id === 'work')
    expect(work?.entryOrder).toEqual(order)
    expect(next.rootEntryOrder).toBe(folders.rootEntryOrder)
  })
})
