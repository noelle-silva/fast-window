import { describe, expect, it } from 'vitest'
import { activeBranchHeadMid, activeBranchHeadMidOrLast, isLeafMessage, newestLeafDescendantMid, resolveRunFocusMid } from './branching'

// 消息树：
//   u1 -> a1 -> u2 -> a2
//                  \-> a2b
//   a2 -> u3 -> a3
function tree() {
  return {
    messages: [
      { id: 'u1', parentMid: '', createdAt: 1 },
      { id: 'a1', parentMid: 'u1', createdAt: 2 },
      { id: 'u2', parentMid: 'a1', createdAt: 3 },
      { id: 'a2', parentMid: 'u2', createdAt: 4 },
      { id: 'a2b', parentMid: 'u2', createdAt: 5 },
      { id: 'u3', parentMid: 'a2', createdAt: 6 },
      { id: 'a3', parentMid: 'u3', createdAt: 7 },
    ],
  }
}

function chatWithBranching() {
  return {
    messages: [
      { id: 'u1', parentMid: '', createdAt: 1 },
      { id: 'a1', parentMid: 'u1', createdAt: 2 },
      { id: 'a1b', parentMid: 'u1', createdAt: 3 },
    ],
    branching: {
      activeBranchId: 'main',
      branches: [
        { id: 'main', headMid: 'a1' },
        { id: 'b1', headMid: 'a1b' },
      ],
    },
  }
}

describe('branching 活动分支头部读取', () => {
  it('activeBranchHeadMid 读取活动分支头部，不做回落', () => {
    const chat = chatWithBranching()
    expect(activeBranchHeadMid(chat)).toBe('a1')
    // 切到另一分支
    chat.branching.activeBranchId = 'b1'
    expect(activeBranchHeadMid(chat)).toBe('a1b')
  })

  it('activeBranchHeadMid 缺失时返回空串', () => {
    expect(activeBranchHeadMid(null)).toBe('')
    expect(activeBranchHeadMid({ messages: [] })).toBe('')
    const chat = chatWithBranching()
    chat.branching.branches[0].headMid = ''
    expect(activeBranchHeadMid(chat)).toBe('')
  })

  it('activeBranchHeadMidOrLast 头部缺失时回落最后一条消息', () => {
    const chat = chatWithBranching()
    chat.branching.branches[0].headMid = ''
    expect(activeBranchHeadMidOrLast(chat)).toBe('a1b')
    // 头部存在时不回落
    chat.branching.branches[0].headMid = 'a1'
    expect(activeBranchHeadMidOrLast(chat)).toBe('a1')
  })

  it('activeBranchHeadMidOrLast 无消息时返回空串', () => {
    expect(activeBranchHeadMidOrLast({ branching: { activeBranchId: 'main', branches: [{ id: 'main', headMid: '' }] } })).toBe('')
  })
})

describe('branching 路径末端基元', () => {
  it('isLeafMessage 判定叶子', () => {
    const chat = tree()
    expect(isLeafMessage(chat, 'a3')).toBe(true)
    expect(isLeafMessage(chat, 'a2b')).toBe(true)
    expect(isLeafMessage(chat, 'a2')).toBe(false)
    expect(isLeafMessage(chat, 'u2')).toBe(false)
    expect(isLeafMessage(chat, 'nope')).toBe(false)
    expect(isLeafMessage(chat, '')).toBe(false)
  })

  it('newestLeafDescendantMid 求锚点之下的最新叶子', () => {
    const chat = tree()
    // 从 u2 往下有两条叶子 a2b 与 a3，取 createdAt 更大者 a3
    expect(newestLeafDescendantMid(chat, 'u2')).toBe('a3')
    // 从 a2 往下只有 a3
    expect(newestLeafDescendantMid(chat, 'a2')).toBe('a3')
    // 无锚点时取全树最新叶子
    expect(newestLeafDescendantMid(chat, '')).toBe('a3')
  })

  it('newestLeafDescendantMid 支持排除集（本次运行前的旧节点）', () => {
    const chat = tree()
    // 排除 u2 之下全部旧节点后，无新叶子
    expect(newestLeafDescendantMid(chat, 'u2', '', new Set(['u2', 'a2', 'a2b', 'u3', 'a3']))).toBe('')
    // 只排除部分时，未被排除的旧父节点会因无子而成为候选叶子
    expect(newestLeafDescendantMid(chat, 'u2', '', new Set(['a2b', 'a3']))).toBe('u3')
  })

  it('resolveRunFocusMid 产出是叶子时采纳产出', () => {
    const chat = tree()
    expect(resolveRunFocusMid(chat, { anchorMid: 'u2', outputMid: 'a3' })).toBe('a3')
  })

  it('resolveRunFocusMid 产出不是叶子时回落到锚点下最新叶子', () => {
    const chat = tree()
    // a2 有子节点，不是叶子；回落到 a2 之下最新叶子 a3
    expect(resolveRunFocusMid(chat, { anchorMid: 'u2', outputMid: 'a2' })).toBe('a3')
  })

  it('resolveRunFocusMid 产出是本次新节点时采纳它', () => {
    const chat = tree()
    const exclude = new Set(['u1', 'a1', 'u2', 'a2', 'a2b', 'u3'])
    expect(resolveRunFocusMid(chat, { anchorMid: 'u3', outputMid: 'a3' }, exclude)).toBe('a3')
  })

  it('resolveRunFocusMid 产出被排除时回落到锚点下最新叶子', () => {
    const chat = tree()
    // 产出 a3 被排除；锚点 u3 之下剩 u3 自身，成为叶子
    expect(resolveRunFocusMid(chat, { anchorMid: 'u3', outputMid: 'a3' }, new Set(['a3']))).toBe('u3')
    // 排除锚点之下全部旧节点后无新叶子
    expect(resolveRunFocusMid(chat, { anchorMid: 'u3', outputMid: 'a3' }, new Set(['u3', 'a3']))).toBe('')
  })

  it('resolveRunFocusMid 空输入安全', () => {
    expect(resolveRunFocusMid(null, { anchorMid: 'u1', outputMid: 'a1' })).toBe('')
    expect(resolveRunFocusMid(tree(), null)).toBe('')
    expect(resolveRunFocusMid(tree(), { anchorMid: '', outputMid: '' })).toBe('a3')
  })
})
