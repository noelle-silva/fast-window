import { describe, expect, it } from 'vitest'
import {
  backendFactRows,
  createSessionFactsHarness,
  viewFactRows,
  type SessionFactsHarness,
} from '../testing/sessionFactsCrossSourceHarness'

// 跨来源回归：同一个会话事实被三类来源写入之后，
// 界面呈现（视图里的 messages）必须与后台会话文档逐项一致：
// 消息存在性、正文、顺序、父子拓扑。前端不保留任何「防吞字」兜底。

function seedConversation(harness: SessionFactsHarness) {
  harness.backend.seed([
    { id: 'message-1', role: 'user', content: '第一问' },
    { id: 'message-2', role: 'assistant', content: '第一答' },
    { id: 'message-3', role: 'user', content: '第二问' },
    { id: 'message-4', role: 'assistant', content: '第二答' },
    { id: 'message-5', role: 'assistant', content: '第二答的并排回答', parentMessageId: 'message-3' },
  ])
}

async function prepare(harness: SessionFactsHarness) {
  seedConversation(harness)
  await harness.loadInitialConversation()
  harness.start()
}

function expectViewMatchesBackend(harness: SessionFactsHarness) {
  expect(viewFactRows(harness.viewMessages())).toEqual(backendFactRows(harness.backend.session.messages))
}

describe('会话事实源跨来源回归', () => {
  it('本地输入发送：新增消息与会话落盘收尾后，界面与后台事实逐项一致', async () => {
    const harness = createSessionFactsHarness()
    await prepare(harness)
    try {
      const added = harness.backend.appendMessages([
        { role: 'user', content: '本地输入的问题' },
        { role: 'assistant', content: '本地输入的回复' },
      ])
      expect(added.event.changeType).toBe('message_added')
      harness.emit(added.event)
      await harness.settle()
      expectViewMatchesBackend(harness)

      const persisted = harness.backend.persistSession()
      expect(persisted.changeType).toBe('session_persisted')
      harness.emit(persisted)
      await harness.settle()
      expectViewMatchesBackend(harness)
      expect(harness.viewChat()?.sessionVersion).toBe(harness.backend.session.version)
    } finally {
      harness.stop()
    }
  })

  it('外部工具代发：新增消息后，界面与后台事实逐项一致', async () => {
    const harness = createSessionFactsHarness()
    await prepare(harness)
    try {
      const delivered = harness.backend.appendMessages([
        { role: 'user', content: '外部工具代发的消息' },
        { role: 'assistant', content: '外部工具代发的回复' },
      ])
      expect(delivered.event.changeType).toBe('message_added')
      harness.emit(delivered.event)
      await harness.settle()

      expectViewMatchesBackend(harness)
      expect(harness.viewMessages().some((message: any) => message.content === '外部工具代发的消息')).toBe(true)
    } finally {
      harness.stop()
    }
  })

  it('外部直接删改：删除单条消息后，界面与后台事实逐项一致', async () => {
    const harness = createSessionFactsHarness()
    await prepare(harness)
    try {
      // 外部直接改存储：不广播事件，界面在重连版本核对后才收敛。
      expect(harness.backend.deleteMessage('message-2').changeType).toBe('message_deleted')
      expect(harness.viewMessages().some((message: any) => message.id === 'message-2')).toBe(true)

      harness.reconnect()
      await harness.settle()

      expectViewMatchesBackend(harness)
      expect(harness.viewMessages().some((message: any) => message.id === 'message-2')).toBe(false)
    } finally {
      harness.stop()
    }
  })

  it('外部直接删改：删除消息子树后，界面与后台事实逐项一致', async () => {
    const harness = createSessionFactsHarness()
    await prepare(harness)
    try {
      expect(harness.backend.deleteSubtree('message-3').changeType).toBe('message_subtree_deleted')

      harness.reconnect()
      await harness.settle()

      expectViewMatchesBackend(harness)
      expect(harness.viewMessages().map((message: any) => message.id)).toEqual(['message-1', 'message-2'])
    } finally {
      harness.stop()
    }
  })

  it('外部直接删改：编辑消息正文后，界面与后台事实逐项一致', async () => {
    const harness = createSessionFactsHarness()
    await prepare(harness)
    try {
      expect(harness.backend.editMessage('message-2', '第一答（外部直接改写）').changeType).toBe('message_edited')

      harness.reconnect()
      await harness.settle()

      expectViewMatchesBackend(harness)
      expect(harness.viewMessages().find((message: any) => message.id === 'message-2')?.content).toBe(
        '第一答（外部直接改写）',
      )
    } finally {
      harness.stop()
    }
  })
})
