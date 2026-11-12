import type { SessionDesks } from '../domain/desks'

// 工作桌面的拖拽动作串。
//
// 每一串都是「先摆一个桌面 → 依次做几次换位 → 看最终顺序」。
// 这份数据是单一事实来源：
//   - desksMove.test.ts 逐条跑，当回归防线
//   - __eucliStudioDiagnostics.deskDrag 用它做控制台回放
//
// 动作里的 from / to 用简写：
//   chat:c2    某条会话
//   group:g1   某个分组
// 落点位置（上半 / 下半）属于界面层的事，数据层只看「落在谁身上」。

export type DeskDragAction = { from: string; to: string }

export type DeskDragCase = {
  id: string
  desc: string
  build: () => SessionDesks
  actions: DeskDragAction[]
  expect: string[]
}

function ref(chatId: string) {
  return { targetKind: 'role' as const, targetId: 'role-a', roleId: '', chatId, addedAt: 0 }
}

function group(id: string, name: string, collapsed: boolean, chatIds: string[]) {
  return {
    type: 'group' as const,
    group: {
      id,
      name,
      color: '',
      collapsed,
      chats: chatIds.map(ref),
      createdAt: 1,
      updatedAt: 1,
    },
  }
}

/**
 * 原型上验证过的那份初始桌面：
 *   c1 · g1(展开 c2,c3) · c4 · g2(收起 c5,c6,c7) · g3(展开 c8) · c9
 */
export function buildInitialDesks(): SessionDesks {
  return {
    items: [
      { type: 'chat', chat: ref('c1') },
      group('g1', '组一', false, ['c2', 'c3']),
      { type: 'chat', chat: ref('c4') },
      group('g2', '组二', true, ['c5', 'c6', 'c7']),
      group('g3', '组三', false, ['c8']),
      { type: 'chat', chat: ref('c9') },
    ],
  }
}

/** 把一份桌面摊成一行行文本，直接和 expect 比对。 */
export function describeDesks(desks: SessionDesks): string[] {
  return desks.items.map((item) =>
    item.type === 'chat'
      ? `c:${item.chat.chatId}`
      : `g:${item.group.id}(${item.group.collapsed ? '收起' : '展开'}:${item.group.chats.map((chat) => chat.chatId).join(',')})`,
  )
}

export const DESK_DRAG_CASES: DeskDragCase[] = [
  {
    id: 'chat-top-down',
    desc: '顶层会话 c1 向下落到 c4 的位置',
    build: buildInitialDesks,
    actions: [{ from: 'chat:c1', to: 'chat:c4' }],
    expect: ['g:g1(展开:c2,c3)', 'c:c4', 'c:c1', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'],
  },
  {
    id: 'chat-top-up',
    desc: '顶层会话 c9 向上落到 c1 的位置',
    build: buildInitialDesks,
    actions: [{ from: 'chat:c9', to: 'chat:c1' }],
    expect: ['c:c9', 'c:c1', 'g:g1(展开:c2,c3)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)'],
  },
  {
    id: 'chat-to-collapsed',
    desc: '会话 c1 落到收起分组 g2 的位置',
    build: buildInitialDesks,
    actions: [{ from: 'chat:c1', to: 'group:g2' }],
    expect: ['g:g1(展开:c2,c3)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'c:c1', 'g:g3(展开:c8)', 'c:c9'],
  },
  {
    id: 'chat-into-expanded',
    desc: '顶层会话 c1 拖进展开分组 g1，落在 c2 上',
    build: buildInitialDesks,
    actions: [{ from: 'chat:c1', to: 'chat:c2' }],
    expect: ['g:g1(展开:c1,c2,c3)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'],
  },
  {
    id: 'chat-out-of-group',
    desc: '组内成员 c2 拖到顶层 c9 的位置',
    build: buildInitialDesks,
    actions: [{ from: 'chat:c2', to: 'chat:c9' }],
    expect: ['c:c1', 'g:g1(展开:c3)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c2', 'c:c9'],
  },
  {
    id: 'member-reorder-down',
    desc: '组内 c2 向下落到 c3 的位置',
    build: buildInitialDesks,
    actions: [{ from: 'chat:c2', to: 'chat:c3' }],
    expect: ['c:c1', 'g:g1(展开:c3,c2)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'],
  },
  {
    id: 'member-reorder-up',
    desc: '组内 c3 向上落到 c2 的位置',
    build: buildInitialDesks,
    actions: [{ from: 'chat:c3', to: 'chat:c2' }],
    expect: ['c:c1', 'g:g1(展开:c3,c2)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'],
  },
  {
    id: 'chat-to-group-header',
    desc: '会话 c4 落到展开分组 g1 的位置（整组往下让）',
    build: buildInitialDesks,
    actions: [{ from: 'chat:c4', to: 'group:g1' }],
    expect: ['c:c1', 'c:c4', 'g:g1(展开:c2,c3)', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'],
  },
  {
    id: 'member-to-own-header',
    desc: '组内 c2 落到自己组的标签头（从组里出来，落到组前面）',
    build: buildInitialDesks,
    actions: [{ from: 'chat:c2', to: 'group:g1' }],
    expect: ['c:c1', 'c:c2', 'g:g1(展开:c3)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'],
  },
  {
    id: 'group-collapsed-vs-expanded',
    desc: '收起分组 g2 落到展开分组 g3 的位置',
    build: buildInitialDesks,
    actions: [{ from: 'group:g2', to: 'group:g3' }],
    expect: ['c:c1', 'g:g1(展开:c2,c3)', 'c:c4', 'g:g3(展开:c8)', 'g:g2(收起:c5,c6,c7)', 'c:c9'],
  },
  {
    id: 'group-expanded-vs-expanded',
    desc: '展开分组 g1 落到展开分组 g3 的位置（整块一起走）',
    build: buildInitialDesks,
    actions: [{ from: 'group:g1', to: 'group:g3' }],
    expect: ['c:c1', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'g:g1(展开:c2,c3)', 'c:c9'],
  },
  {
    id: 'group-expanded-vs-collapsed',
    desc: '展开分组 g3 落到收起分组 g2 的位置',
    build: buildInitialDesks,
    actions: [{ from: 'group:g3', to: 'group:g2' }],
    expect: ['c:c1', 'g:g1(展开:c2,c3)', 'c:c4', 'g:g3(展开:c8)', 'g:g2(收起:c5,c6,c7)', 'c:c9'],
  },
  {
    id: 'group-expanded-to-top',
    desc: '展开分组 g3 整体拖到最上方 c1 的位置',
    build: buildInitialDesks,
    actions: [{ from: 'group:g3', to: 'chat:c1' }],
    expect: ['g:g3(展开:c8)', 'c:c1', 'g:g1(展开:c2,c3)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'c:c9'],
  },
  {
    id: 'seq-member-out-then-top',
    desc: '先把成员 c2 拖出组，再把它拖到最上方',
    build: buildInitialDesks,
    actions: [
      { from: 'chat:c2', to: 'chat:c9' },
      { from: 'chat:c2', to: 'chat:c1' },
    ],
    expect: ['c:c2', 'c:c1', 'g:g1(展开:c3)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'],
  },
  {
    id: 'seq-group-move-twice',
    desc: '展开分组 g1 先落到 g3，再拖回最上方',
    build: buildInitialDesks,
    actions: [
      { from: 'group:g1', to: 'group:g3' },
      { from: 'group:g1', to: 'chat:c1' },
    ],
    expect: ['g:g1(展开:c2,c3)', 'c:c1', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'],
  },
  {
    id: 'seq-member-out-and-back',
    desc: '成员 c2 先拖出组，再拖回自己组的标签头',
    build: buildInitialDesks,
    actions: [
      { from: 'chat:c2', to: 'chat:c9' },
      { from: 'chat:c2', to: 'group:g1' },
    ],
    expect: ['c:c1', 'c:c2', 'g:g1(展开:c3)', 'c:c4', 'g:g2(收起:c5,c6,c7)', 'g:g3(展开:c8)', 'c:c9'],
  },
]
