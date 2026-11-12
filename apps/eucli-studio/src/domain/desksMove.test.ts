import { describe, expect, it } from 'vitest'
import {
  deskChatKey,
  deskChatRowId,
  deskGroupRowId,
  dissolveDeskGroup,
  moveDeskUnit,
  planDeskGroupDisband,
  removeDeskGroupWithChats,
  toggleDeskGroupCollapsed,
  type SessionDesks,
} from './desks'
import { DESK_DRAG_CASES, buildInitialDesks, describeDesks, type DeskDragAction } from '../testing/deskDragCases'

// 换位是工作桌面唯一的顺序写入口：顶层换位、会话进出分组、组内换序都走它。
// 动作串本身放在 src/testing/deskDragCases.ts —— 控制台诊断用的是同一份数据。

/** 把动作里的简写翻译成真正的行标识。 */
function rowIdOf(desks: SessionDesks, token: string): string {
  const [kind, id] = String(token).split(':')
  if (kind === 'group') return deskGroupRowId(id)
  for (const item of desks.items) {
    if (item.type === 'chat' && item.chat.chatId === id) return deskChatRowId(deskChatKey(item.chat))
    if (item.type === 'group') {
      const chat = item.group.chats.find((entry) => entry.chatId === id)
      if (chat) return deskChatRowId(deskChatKey(chat))
    }
  }
  throw new Error(`动作里引用了不存在的会话：${token}`)
}

function runActions(desks: SessionDesks, actions: DeskDragAction[]): SessionDesks {
  let current = desks
  for (const action of actions) {
    current = moveDeskUnit(current, rowIdOf(current, action.from), rowIdOf(current, action.to))
  }
  return current
}

describe('工作桌面拖拽动作串', () => {
  for (const item of DESK_DRAG_CASES) {
    it(`${item.id}：${item.desc}`, () => {
      const next = runActions(item.build(), item.actions)
      expect(describeDesks(next)).toEqual(item.expect)
    })
  }

  it('拖到自己身上不做任何事', () => {
    const before = buildInitialDesks()
    const after = moveDeskUnit(before, deskChatRowId(deskChatKey(before.items[0] as any)), deskChatRowId(deskChatKey(before.items[0] as any)))
    expect(after).toBe(before)
  })

  it('落点不在清单里时原样返回', () => {
    const before = buildInitialDesks()
    const after = moveDeskUnit(before, deskChatRowId('role::role-a::::c1'), deskChatRowId('role::nobody::::nope'))
    expect(after).toBe(before)
  })
})

describe('解散分组的后果描述', () => {
  it('连成员一起移出：带走全部成员', () => {
    const plan = planDeskGroupDisband(buildInitialDesks(), 'g1', 'remove-with-chats')
    expect(plan).toEqual({
      mode: 'remove-with-chats',
      groupId: 'g1',
      groupName: '组一',
      leavingChats: 2,
      keepingChats: 0,
    })
  })

  it('仅解散：一条都不带走，全部留下', () => {
    const plan = planDeskGroupDisband(buildInitialDesks(), 'g1', 'dissolve')
    expect(plan?.leavingChats).toBe(0)
    expect(plan?.keepingChats).toBe(2)
  })

  it('空组：两种方式都不带走东西', () => {
    const base = buildInitialDesks()
    const desks: SessionDesks = {
      items: [
        ...base.items,
        {
          type: 'group',
          group: { id: 'g9', name: '空组', color: '', collapsed: false, chats: [], createdAt: 1, updatedAt: 1 },
        },
      ],
    }
    expect(planDeskGroupDisband(desks, 'g9', 'remove-with-chats')?.leavingChats).toBe(0)
    expect(planDeskGroupDisband(desks, 'g9', 'dissolve')?.keepingChats).toBe(0)
  })

  it('组不存在时返回 null，界面不会凭空弹出一个框', () => {
    expect(planDeskGroupDisband(buildInitialDesks(), 'nope', 'dissolve')).toBeNull()
  })
})

describe('分组折叠', () => {
  it('切换折叠状态不动顺序', () => {
    const next = toggleDeskGroupCollapsed(buildInitialDesks(), 'g2')
    expect(describeDesks(next)).toEqual([
      'c:c1',
      'g:g1(展开:c2,c3)',
      'c:c4',
      'g:g2(展开:c5,c6,c7)',
      'g:g3(展开:c8)',
      'c:c9',
    ])
  })
})

describe('解散分组的两种语义', () => {
  it('仅解散：成员摊平到组原来的位置', () => {
    const next = dissolveDeskGroup(buildInitialDesks(), 'g1')
    expect(describeDesks(next)).toEqual(['c:c1', 'c:c2', 'c:c3', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'])
  })

  it('连成员一起移出：组和它的成员一起消失', () => {
    const next = removeDeskGroupWithChats(buildInitialDesks(), 'g1')
    expect(describeDesks(next)).toEqual(['c:c1', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'])
  })
})
