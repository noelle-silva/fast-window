import { describe, expect, it } from 'vitest'
import { normalizeData } from '../domain/dataNormalizers'
import { activeBranchHeadMid } from '../domain/branching'
import { normalizeStoredChat } from './normalizeStoredChat'
import {
  BOUNDARY_CHAT_ID,
  BOUNDARY_ROLE_ID,
  SECOND_ASSISTANT_MESSAGE_ID,
  SECOND_USER_MESSAGE_ID,
  rawSessionDataDocument,
  rawSessionDocument,
} from '../testing/boundaryFixtures'

// 边界一：原始字节 → 归一化。
//
// 契约：业务端线格式（ISO 时间、parentMessageId、已存 branching）进入
// normalizeStoredChat / normalizeData 之后，内存里只能留下一种形状：
//   - 每条消息都有 parentMid（用户消息也不能断链）；
//   - createdAt / updatedAt 是数值毫秒；
//   - 已存分支头是服务端事实，不能被数组末端或兜底值回退；
//   - 没有 id 的文档不能凭空生成会话（无幽灵）。

describe('契约·边界一：原始字节 → 归一化', () => {
  it('真实会话响应归一化后保留完整父子链、数值时间与已存分支头', () => {
    const chat = normalizeStoredChat(rawSessionDocument(), 'role')

    expect(chat).not.toBeNull()
    const messages = chat?.messages || []
    expect(messages.find((message: any) => message.id === SECOND_USER_MESSAGE_ID)?.parentMid).toBe(
      'message-1793460445487972300-17745',
    )
    expect(messages.find((message: any) => message.id === SECOND_ASSISTANT_MESSAGE_ID)?.parentMid).toBe(
      SECOND_USER_MESSAGE_ID,
    )
    expect(typeof messages[0]?.createdAt).toBe('number')
    expect(typeof chat?.updatedAt).toBe('number')
    expect(chat?.updatedAt).toBe(Date.parse('2026-10-31T17:39:14.4078946Z'))

    // main 分支头停在 a2，而数组末尾是 alt 分支消息：不能回退成最后一条。
    expect(activeBranchHeadMid(chat)).toBe(SECOND_ASSISTANT_MESSAGE_ID)
  })

  it('真实数据文档归一化后必须把规范会话写回 box，并据此重算列表投影', () => {
    const data = normalizeData(rawSessionDataDocument())
    const box = data.chatsByRole[BOUNDARY_ROLE_ID]

    expect(box.chats).toHaveLength(1)
    const normalized = box.chats[0]
    expect(normalized.id).toBe(BOUNDARY_CHAT_ID)
    expect(typeof normalized.updatedAt).toBe('number')
    expect(normalized.messages.find((message: any) => message.id === SECOND_USER_MESSAGE_ID)?.parentMid).toBe(
      'message-1793460445487972300-17745',
    )
    expect(activeBranchHeadMid(normalized)).toBe(SECOND_ASSISTANT_MESSAGE_ID)

    const meta = box.chatMetas.find((item: any) => item.id === BOUNDARY_CHAT_ID)
    expect(meta?.title).toBe('分支与窗口回归')
    expect(meta?.updatedAt).toBe(Date.parse('2026-10-31T17:39:14.4078946Z'))
  })

  it('缺失 id 的会话文档不生成幽灵会话', () => {
    expect(normalizeStoredChat({ title: '无 id', messages: [] }, 'role')).toBeNull()
  })
})
