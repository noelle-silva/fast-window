import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION,
  followFrom,
  latestMessageMid,
  placeSelection,
  resolveSelection,
  selectionAtLatest,
} from './viewSelection'

// 位置只有一个值；解析只做一件事：当时放在末尾就顺着子节点走到新末尾。
// 这里同时守住三条曾经出过问题的边界：数组顺序不代表时间、看中间节点不动、
// 位置失效不悬空。

type Msg = { id: string; parentMid: string; createdAt: number }

function chat(messages: Msg[]) {
  return { messages }
}

// 旧线：u1 → a1 → u2 → a2。用户回到 a1，从那里分出去，长出 u3。
function oldLine(): Msg[] {
  return [
    { id: 'u1', parentMid: '', createdAt: 1 },
    { id: 'a1', parentMid: 'u1', createdAt: 2 },
    { id: 'u2', parentMid: 'a1', createdAt: 3 },
    { id: 'a2', parentMid: 'u2', createdAt: 4 },
  ]
}

// Agent 端给的数组按分支分组，不按时间：新的 u3 排在中间，旧的 a2 仍排最后
function forkedArray(): Msg[] {
  return [
    { id: 'u1', parentMid: '', createdAt: 1 },
    { id: 'a1', parentMid: 'u1', createdAt: 2 },
    { id: 'u3', parentMid: 'a1', createdAt: 5 },
    { id: 'u2', parentMid: 'a1', createdAt: 3 },
    { id: 'a2', parentMid: 'u2', createdAt: 4 },
  ]
}

describe('viewSelection 位置解析', () => {
  it('切会话：落到最晚创建的一条，与数组顺序无关', () => {
    const c = chat(forkedArray())
    expect(latestMessageMid(c)).toBe('u3')
    expect(selectionAtLatest(c)).toEqual({ mid: 'u3', atEnd: true })
  })

  it('空会话：位置为空，不悬空', () => {
    expect(selectionAtLatest(chat([]))).toEqual(EMPTY_SELECTION)
    expect(placeSelection(chat([]), 'x')).toEqual(EMPTY_SELECTION)
  })

  it('看着末尾：长出一层就跟一层，先到先得，兄弟不再带走位置', () => {
    const placed = placeSelection(chat(oldLine()), 'a2')
    expect(placed).toEqual({ mid: 'a2', atEnd: true })

    const oneChild = chat([...oldLine(), { id: 'u3', parentMid: 'a2', createdAt: 5 }])
    expect(resolveSelection(oneChild, placed)).toEqual({ mid: 'u3', atEnd: true })

    const twoSteps = chat([...oldLine(), { id: 'u3-late', parentMid: 'a2', createdAt: 9 }, { id: 'u3', parentMid: 'a2', createdAt: 5 }])
    expect(resolveSelection(twoSteps, placed).mid).toBe('u3')

    const siblingAndChild = chat([...twoSteps.messages, { id: 'a3', parentMid: 'u3', createdAt: 10 }])
    expect(resolveSelection(siblingAndChild, { mid: 'u3', atEnd: true }).mid).toBe('a3')
  })

  it('看着中间节点：下面长出新节点也不动', () => {
    const placed = placeSelection(chat(oldLine()), 'a1')
    expect(placed.atEnd).toBe(false)
    const grown = chat([...oldLine(), { id: 'a1b', parentMid: 'a1', createdAt: 7 }])
    expect(resolveSelection(grown, placed).mid).toBe('a1')
  })

  it('位置失效：落到最晚创建的一条，不按数组最后一条猜', () => {
    const placed = placeSelection(chat(oldLine()), 'a2')
    const afterDelete = chat(forkedArray().filter((m) => m.id !== 'a2'))
    // 数组最后一条是 u2（旧线），最晚创建的是 u3
    expect(resolveSelection(afterDelete, placed)).toEqual({ mid: 'u3', atEnd: true })
  })

  it('回复先到、运行卡后到：落点仍然跟随，不因“当时已有孩子”停住', () => {
    // 动作一用的是 followFrom：跟随由动作决定，与此刻有没有孩子无关
    const placed = followFrom('u3')
    const withReply = chat([...forkedArray(), { id: 'a3', parentMid: 'u3', createdAt: 6 }])
    expect(resolveSelection(withReply, placed)).toEqual({ mid: 'a3', atEnd: true })
  })

  it('点节点用 placeSelection：点中间节点就停住，不被新内容带走', () => {
    const placed = placeSelection(chat(oldLine()), 'a1')
    expect(placed.atEnd).toBe(false)
  })
  it('删除后回退：父节点还有别的孩子时，停在父节点，不滑到底部', () => {
    // 链：u1 → a1 → u2；a1 下面还有一条兄弟 a1b（删掉的不是它）
    const messages = [
      { id: 'u1', parentMid: '', createdAt: 1 },
      { id: 'a1', parentMid: 'u1', createdAt: 2 },
      { id: 'u2', parentMid: 'a1', createdAt: 3 },
      { id: 'a1b', parentMid: 'u1', createdAt: 4 },
    ]
    // 退回用的是 placeSelection：父节点此刻还有孩子，所以“停住”
    const retreated = placeSelection(chat(messages), 'u1')
    expect(retreated).toEqual({ mid: 'u1', atEnd: false })
    expect(resolveSelection(chat(messages), retreated).mid).toBe('u1')
  })
})
