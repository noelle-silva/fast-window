import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION,
  latestMessageMid,
  placeSelection,
  resolveSelection,
  selectionAtLatest,
} from './viewSelection'

// 视图位置只有两条动作：我发起的运行被受理、以及「我看着末尾，它下面长出新节点」。
// 这里验证的是第二条：位置只往下推进一格一格，看着中间节点时不动，兄弟不带走位置。

type Msg = { id: string; parentMid: string; createdAt: number }

function chat(messages: Msg[]) {
  return { messages }
}

function mainChain(): Msg[] {
  return [
    { id: 'u1', parentMid: '', createdAt: 1 },
    { id: 'a1', parentMid: 'u1', createdAt: 2 },
    { id: 'u2', parentMid: 'a1', createdAt: 3 },
    { id: 'a2', parentMid: 'u2', createdAt: 4 },
  ]
}

describe('viewSelection 位置解析', () => {
  it('切会话：位置落在最靠后的一条消息上', () => {
    const c = chat(mainChain())
    expect(latestMessageMid(c)).toBe('a2')
    expect(selectionAtLatest(c)).toEqual({ mid: 'a2', atEnd: true, chain: ['u2', 'a1', 'u1'] })
  })

  it('空会话：位置为空，不产生悬空节点', () => {
    expect(selectionAtLatest(chat([]))).toEqual(EMPTY_SELECTION)
    expect(placeSelection(chat([]), 'not-exist')).toEqual(EMPTY_SELECTION)
  })

  it('点末尾节点后长出子节点：位置推到新节点，继续长就继续推', () => {
    const before = chat(mainChain())
    const placed = placeSelection(before, 'a2')
    expect(placed.atEnd).toBe(true)

    const afterOne = chat([...mainChain(), { id: 'u3', parentMid: 'a2', createdAt: 5 }])
    const step1 = resolveSelection(afterOne, placed)
    expect(step1.mid).toBe('u3')
    expect(step1.atEnd).toBe(true)

    const afterTwo = chat([...mainChain(), { id: 'u3', parentMid: 'a2', createdAt: 5 }, { id: 'a3', parentMid: 'u3', createdAt: 6 }])
    const step2 = resolveSelection(afterTwo, step1)
    expect(step2.mid).toBe('a3')
    expect(step2.atEnd).toBe(true)
  })

  it('一次长出两个子节点：先到先得，另一个不带走位置', () => {
    const before = chat(mainChain())
    const placed = placeSelection(before, 'a2')
    // 后到的兄弟先挂上来，先到的那条时间更早，按顺序取它
    const after = chat([...mainChain(), { id: 'u3-late', parentMid: 'a2', createdAt: 9 }, { id: 'u3', parentMid: 'a2', createdAt: 5 }])
    const next = resolveSelection(after, placed)
    expect(next.mid).toBe('u3')

    // 位置已经在 u3 上：兄弟仍挂在 a2 下面，不再移动
    const laterStep = resolveSelection(after, next)
    expect(laterStep.mid).toBe('u3')
  })

  it('看着中间节点：下面长出新节点也不动', () => {
    const before = chat(mainChain())
    const placed = placeSelection(before, 'a1')
    expect(placed.atEnd).toBe(false)

    const after = chat([...mainChain(), { id: 'a1b', parentMid: 'a1', createdAt: 7 }])
    const kept = resolveSelection(after, placed)
    expect(kept.mid).toBe('a1')
  })

  it('节点被删掉：沿上级退回最近一个还在的节点，然后停住', () => {
    const placed = placeSelection(chat(mainChain()), 'a2')
    const after = chat(mainChain().filter((m) => m.id !== 'a2'))
    const restored = resolveSelection(after, placed)
    expect(restored.mid).toBe('u2')
    expect(restored.atEnd).toBe(false)
    // 退回之后不再自动往下推：新长出来的节点不会把位置带走
    const grown = chat([...after.messages, { id: 'a2-new', parentMid: 'u2', createdAt: 8 }])
    expect(resolveSelection(grown, restored).mid).toBe('u2')
  })

  it('整条链都不在了：交回空位置，不留悬空节点', () => {
    const placed = placeSelection(chat(mainChain()), 'a2')
    expect(resolveSelection(chat([]), placed)).toEqual(EMPTY_SELECTION)
  })
})
