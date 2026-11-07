import { describe, expect, it } from 'vitest'
import {
  collectIndexedPromptIds,
  mergePromptOrder,
  normalizePromptFolderLibrary,
  normalizePromptLibrary,
  promptFolderParentId,
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
  folders: [
    { id: 'work', name: '工作', folderIds: ['backend'], promptIds: ['p2', 'p1'], createdAt: '', updatedAt: '' },
    { id: 'backend', name: '后端', folderIds: [], promptIds: ['p3'], createdAt: '', updatedAt: '' },
    { id: 'life', name: '生活', folderIds: [], promptIds: ['p1'], createdAt: '', updatedAt: '' },
  ],
}

describe('resolvePromptFolderLayer', () => {
  it('根级只展示没被任何收藏夹索引的条目', () => {
    const layer = resolvePromptFolderLayer(folders, prompts, '')
    expect(layer.folders.map((folder) => folder.id)).toEqual(['work', 'life'])
    // p1、p2、p3 都已被收藏，根级不再重复出现
    expect(layer.prompts).toEqual([])
    expect(layer.crumbs).toEqual([{ id: '', name: '全部提示词' }])
  })

  it('夹内按索引顺序展示子夹与条目', () => {
    const layer = resolvePromptFolderLayer(folders, prompts, 'work')
    expect(layer.folders.map((folder) => folder.id)).toEqual(['backend'])
    expect(layer.prompts.map((prompt) => prompt.id)).toEqual(['p2', 'p1'])
    expect(layer.crumbs.map((crumb) => crumb.name)).toEqual(['全部提示词', '工作'])
  })

  it('深层路径给到完整面包屑，并能算出上一级', () => {
    const layer = resolvePromptFolderLayer(folders, prompts, 'backend')
    expect(layer.crumbs.map((crumb) => crumb.id)).toEqual(['', 'work', 'backend'])
    expect(promptFolderParentId(layer)).toBe('work')
    expect(layer.prompts.map((prompt) => prompt.id)).toEqual(['p3'])
  })

  it('当前夹不存在时回落到根级', () => {
    const layer = resolvePromptFolderLayer(folders, prompts, 'ghost')
    expect(layer.folderId).toBe('')
    expect(layer.crumbs).toHaveLength(1)
  })

  it('模板里缺失的提示词被跳过，不产生空行', () => {
    const stale: PromptFolderLibrary = {
      rootFolderIds: ['work'],
      folders: [{ id: 'work', name: '工作', folderIds: [], promptIds: ['p1', 'gone'], createdAt: '', updatedAt: '' }],
    }
    const layer = resolvePromptFolderLayer(stale, prompts, 'work')
    expect(layer.prompts.map((prompt) => prompt.id)).toEqual(['p1'])
  })
})

describe('collectIndexedPromptIds', () => {
  it('汇总所有收藏夹索引过的条目', () => {
    expect(Array.from(collectIndexedPromptIds(folders)).sort()).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('mergePromptOrder', () => {
  it('只重排给定条目的相对位置，其余条目原位不动', () => {
    const merged = mergePromptOrder(prompts.prompts, ['p3', 'p1'])
    expect(merged.map((prompt) => prompt.id)).toEqual(['p3', 'p2', 'p1'])
  })

  it('空顺序时原样返回', () => {
    expect(mergePromptOrder(prompts.prompts, []).map((prompt) => prompt.id)).toEqual(['p1', 'p2', 'p3'])
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

  it('收藏夹库缺字段时按空集合归一', () => {
    const normalized = normalizePromptFolderLibrary({
      rootFolderIds: ['a', 'a'],
      folders: [{ id: 'a', name: '甲' }],
    })
    expect(normalized.rootFolderIds).toEqual(['a'])
    expect(normalized.folders[0].folderIds).toEqual([])
    expect(normalized.folders[0].promptIds).toEqual([])
  })
})

describe('resolveActiveOwnerId', () => {
  const workspaceIds = ['w1', 'w2']

  it('切换作用域后旧归属不属于当前作用域时回落到第一个', () => {
    // 角色 id 混进工作区请求的现场：旧值 r1 不在工作区列表里
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
