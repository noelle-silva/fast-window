import { describe, expect, it, vi } from 'vitest'
import { createFavoritesLedger, diffFavorites } from './favoritesLedger'
import type { FavoriteItemRef, HyperCortexFavoritesDocV1 } from './favorites'
import type { HyperCortexGateway } from './gateway'

function ref(id: string, folderId: string, kind: FavoriteItemRef['kind'], targetId: string, layout = { x: 0, y: 0, w: 2, h: 2 }): FavoriteItemRef {
  return { id, folderId, kind, targetId, layout, createdAtMs: 1, updatedAtMs: 1 }
}

function doc(overrides: Partial<HyperCortexFavoritesDocV1> = {}): HyperCortexFavoritesDocV1 {
  return {
    version: 1,
    rootFolderId: 'root',
    folders: { root: { id: 'root', title: '根目录', description: '', createdAtMs: 1, updatedAtMs: 1 } },
    refsByFolderId: { root: [] },
    ...overrides,
  }
}

describe('diffFavorites', () => {
  it('新建收藏夹收敛为 createFolder，父引用不再重复放入', () => {
    const prev = doc()
    const next = doc({
      folders: {
        ...prev.folders,
        f1: { id: 'f1', title: '新夹', description: '说明', createdAtMs: 2, updatedAtMs: 2 },
      },
      refsByFolderId: { root: [ref('r1', 'root', 'folder', 'f1')], f1: [] },
    })
    const ops = diffFavorites(prev, next)
    expect(ops).toContainEqual({ type: 'createFolder', id: 'f1', parentId: 'root', title: '新夹', description: '说明' })
    expect(ops.filter(op => op.type === 'addItem')).toHaveLength(0)
  })

  it('放入、移出、挪夹、排序、布局各自收敛为对应语义操作', () => {
    const prev = doc({
      folders: {
        root: { id: 'root', title: '根目录', description: '', createdAtMs: 1, updatedAtMs: 1 },
        a: { id: 'a', title: 'A', description: '', createdAtMs: 1, updatedAtMs: 1 },
        b: { id: 'b', title: 'B', description: '', createdAtMs: 1, updatedAtMs: 1 },
      },
      refsByFolderId: {
        root: [ref('r-note', 'root', 'note', 'n1')],
        a: [ref('r-a1', 'a', 'note', 'n2'), ref('r-a2', 'a', 'note', 'n3')],
        b: [],
      },
    })
    const next = doc({
      folders: prev.folders,
      refsByFolderId: {
        // n2 从 a 挪到 b；n3 留在 a 并改变布局与顺序；root 移除 n1、新增 n4。
        root: [ref('r-note', 'root', 'note', 'n4')],
        a: [ref('r-a2', 'a', 'note', 'n3', { x: 3, y: 1, w: 2, h: 4 })],
        b: [ref('r-a1', 'b', 'note', 'n2')],
      },
    })
    const ops = diffFavorites(prev, next)
    const types = ops.map(op => op.type).sort()
    expect(types).toContain('moveItem')
    expect(types).toContain('addItem')
    expect(types).toContain('removeItem')
    expect(types).toContain('updateItemLayout')
    expect(ops).toContainEqual({ type: 'moveItem', fromFolderId: 'a', toFolderId: 'b', kind: 'note', targetId: 'n2' })
    expect(ops).toContainEqual({ type: 'updateItemLayout', folderId: 'a', kind: 'note', targetId: 'n3', layout: { x: 3, y: 1, w: 2, h: 4 } })
  })

  it('顺序真的变化才报排序', () => {
    const prev = doc({
      refsByFolderId: { root: [ref('r1', 'root', 'note', 'n1'), ref('r2', 'root', 'note', 'n2')] },
    })
    const reordered = doc({
      refsByFolderId: { root: [ref('r2', 'root', 'note', 'n2'), ref('r1', 'root', 'note', 'n1')] },
    })
    const ops = diffFavorites(prev, reordered)
    expect(ops).toContainEqual({
      type: 'reorderItems',
      folderId: 'root',
      ordered: [{ kind: 'note', targetId: 'n2' }, { kind: 'note', targetId: 'n1' }],
    })

    // 末尾追加不触发排序。
    const appended = doc({
      refsByFolderId: { root: [ref('r1', 'root', 'note', 'n1'), ref('r2', 'root', 'note', 'n2'), ref('r3', 'root', 'note', 'n3')] },
    })
    expect(diffFavorites(prev, appended).some(op => op.type === 'reorderItems')).toBe(false)
  })

  it('删除收藏夹收敛为 deleteFolder，指向它的引用收敛为 removeItem', () => {
    const prev = doc({
      folders: {
        root: { id: 'root', title: '根目录', description: '', createdAtMs: 1, updatedAtMs: 1 },
        f1: { id: 'f1', title: '待删', description: '', createdAtMs: 1, updatedAtMs: 1 },
      },
      refsByFolderId: {
        root: [ref('r1', 'root', 'folder', 'f1')],
        f1: [ref('r2', 'f1', 'note', 'n1')],
      },
    })
    const next = doc()
    const ops = diffFavorites(prev, next)
    expect(ops).toContainEqual({ type: 'deleteFolder', folderId: 'f1' })
    expect(ops).toContainEqual({ type: 'removeItem', folderId: 'root', kind: 'folder', targetId: 'f1' })
  })

  it('草稿引用不产生任何写操作；草稿转正按真实笔记标识登记', () => {
    const prev = doc()
    const withDraft = doc({ refsByFolderId: { root: [ref('r1', 'root', 'note', 'draft_abc')] } })
    expect(diffFavorites(prev, withDraft)).toHaveLength(0)

    const promoted = doc({ refsByFolderId: { root: [ref('r1', 'root', 'note', 'n-real')] } })
    const ops = diffFavorites(withDraft, promoted)
    expect(ops).toContainEqual({ type: 'addItem', folderId: 'root', kind: 'note', targetId: 'n-real' })
    expect(ops.some(op => op.type === 'removeItem')).toBe(false)
  })

  it('改夹收敛为 updateFolder', () => {
    const prev = doc()
    const next = doc({ folders: { root: { id: 'root', title: '改名', description: '新说明', createdAtMs: 1, updatedAtMs: 9 } } })
    expect(diffFavorites(prev, next)).toContainEqual({ type: 'updateFolder', folderId: 'root', title: '改名', description: '新说明' })
  })
})

describe('createFavoritesLedger', () => {
  function makeGateway() {
    const favorites = {
      ensureFavorites: vi.fn(async () => doc()),
      createFolder: vi.fn(async () => ({ version: 1 })),
      updateFolder: vi.fn(async () => ({ version: 1 })),
      addItem: vi.fn(async () => ({ version: 1 })),
      removeItem: vi.fn(async () => ({ version: 1 })),
      moveItem: vi.fn(async () => ({ version: 1 })),
      reorderItems: vi.fn(async () => ({ version: 1 })),
      updateItemLayout: vi.fn(async () => ({ version: 1 })),
      deleteFolder: vi.fn(async () => ({ version: 1 })),
    }
    return { gateway: { favorites } as unknown as HyperCortexGateway, favorites }
  }

  it('装载后提交变更：只报语义操作，不再整份文档写回', async () => {
    const { gateway, favorites } = makeGateway()
    const ledger = createFavoritesLedger(gateway, 'library')
    await ledger.load()

    const next = doc({ refsByFolderId: { root: [ref('r1', 'root', 'note', 'n1')] } })
    ledger.commit(next)
    await Promise.resolve()

    expect(favorites.addItem).toHaveBeenCalledWith('library', 'root', 'note', 'n1')
    expect((favorites as any).saveFavorites).toBeUndefined()
  })

  it('采纳后端权威文档：只更新基线，不产生写操作', async () => {
    const { gateway, favorites } = makeGateway()
    const ledger = createFavoritesLedger(gateway, 'library')
    await ledger.load()
    ledger.adopt(doc({ refsByFolderId: { root: [ref('r1', 'root', 'note', 'n1')] } }))
    ledger.commit(doc({ refsByFolderId: { root: [ref('r1', 'root', 'note', 'n1')] } }))
    await Promise.resolve()
    expect(favorites.addItem).not.toHaveBeenCalled()
  })

  it('写入失败经错误出口上报', async () => {
    const { gateway, favorites } = makeGateway()
    favorites.addItem.mockRejectedValueOnce(new Error('后端拒绝'))
    const onError = vi.fn()
    const ledger = createFavoritesLedger(gateway, 'library', { onError })
    await ledger.load()
    ledger.commit(doc({ refsByFolderId: { root: [ref('r1', 'root', 'note', 'n1')] } }))
    await Promise.resolve()
    await Promise.resolve()
    expect(onError).toHaveBeenCalledWith('后端拒绝')
  })
})
