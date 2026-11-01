import { describe, expect, it } from 'vitest'
import {
  resolveChatMessageCollectionFact,
  resolveChatMessageFact,
  resolveChatMessageUnionFact,
  shouldPreserveRuntimeOnlyMessage,
} from './chatBodyPrecedence'
import { ASSISTANT_RUNNING_CONTENT, beginAssistantRun, finishAssistantRun } from './assistantRunState'

function assistant(id: string, content: string, updatedAt = 100) {
  return { id, role: 'assistant', type: 'assistant', content, parentMid: '', createdAt: updatedAt, updatedAt } as any
}

describe('单条消息事实优先级', () => {
  it('本地运行期最终回复不被更旧的存储占位覆盖', () => {
    const local = assistant('m1', '完整回复', 500)
    local.runtimeOnly = true
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })
    finishAssistantRun(local, '完整回复', 'succeeded', 500)

    const stored = assistant('m1', ASSISTANT_RUNNING_CONTENT, 100)
    expect(resolveChatMessageFact({ serverMessage: stored, localMessage: local })).toBe(local)
  })

  it('存储已含最终回复时以存储为准', () => {
    const local = assistant('m1', '流式片段', 200)
    local.runtimeOnly = true
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

    const stored = assistant('m1', '完整回复', 900)
    expect(resolveChatMessageFact({
      serverMessage: stored,
      localMessage: local,
      storedChatStatus: 'completed',
    })).toBe(stored)
  })

  it('双方都收敛时以存储事实为准', () => {
    const local = assistant('m1', '本地旧文', 100)
    const stored = assistant('m1', '服务端正文', 200)
    expect(resolveChatMessageFact({ serverMessage: stored, localMessage: local })).toBe(stored)
  })

  it('异步工具结果材料身份不被普通消息覆盖', () => {
    const local = { id: 'm1', type: 'async_tool_result', role: 'assistant', content: '工具结果' } as any
    const stored = assistant('m1', '普通正文', 200)
    expect(resolveChatMessageFact({ serverMessage: stored, localMessage: local })).toBe(local)
  })
})

describe('消息集合事实优先级', () => {
  it('集合成员资格以服务端为准，删掉的消息不因本地旧文档复活', () => {
    const localGone = assistant('m2', '已删除')
    expect(shouldPreserveRuntimeOnlyMessage(localGone)).toBe(false)

    const merged = resolveChatMessageCollectionFact({
      serverMessages: [assistant('m1', '保留')],
      localMessages: [assistant('m1', '本地旧文'), localGone],
      shouldKeepLocalMessage: shouldPreserveRuntimeOnlyMessage,
    })
    expect(merged.map((message: any) => message.id)).toEqual(['m1'])
    expect(merged[0].content).toBe('保留')
  })

  it('显式运行期独占消息允许补入集合末尾', () => {
    const runtime = assistant('m2', '刚落盘')
    runtime.runtimeOnly = true
    finishAssistantRun(runtime, '刚落盘', 'succeeded', 500)

    const merged = resolveChatMessageCollectionFact({
      serverMessages: [assistant('m1', '历史')],
      localMessages: [runtime],
      shouldKeepLocalMessage: shouldPreserveRuntimeOnlyMessage,
    })
    expect(merged.map((message: any) => message.id)).toEqual(['m1', 'm2'])
  })
})

describe('窗口消息并集事实优先级', () => {
  it('同一 id 以权威新页为准，次级只补缺', () => {
    const merged = resolveChatMessageUnionFact({
      authoritative: [{ id: 'm1', content: '新页' }, { id: 'm2', content: '新页' }],
      secondary: [{ id: 'm1', content: '旧页' }, { id: 'm0', content: '更早历史' }],
    })
    expect(merged.map((message: any) => message.id)).toEqual(['m1', 'm2', 'm0'])
    expect(merged[0].content).toBe('新页')
  })
})
