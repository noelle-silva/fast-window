import { describe, expect, it } from 'vitest'
import {
  resolveChatMessageCollectionFact,
  resolveChatMessageFact,
  resolveChatMessageUnionFact,
  shouldPreserveRuntimeOnlyMessage,
} from './chatBodyPrecedence'
import { beginAssistantRun } from './assistantRunState'
import { clearRuntimeMessageMarker } from './runtimeMessageMarker'

function assistant(id: string, content: string, updatedAt = 100) {
  return { id, role: 'assistant', type: 'assistant', content, parentMid: '', branchId: 'main', createdAt: updatedAt, updatedAt } as any
}

describe('单条消息事实优先级：后台权威覆盖', () => {
  it('在途临时状态是唯一例外：覆盖显示字段，但不改写后台的身份、顺序与拓扑', () => {
    const local = assistant('m1', '流式片段', 500)
    local.parentMid = 'u-local'
    local.branchId = 'branch-local'
    local.createdAt = 900
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

    const stored = assistant('m1', '后台旧占位', 100)
    stored.parentMid = 'u-server'
    stored.branchId = 'branch-server'

    const merged = resolveChatMessageFact({ serverMessage: stored, localMessage: local })
    expect(merged.content).toBe('流式片段')
    expect(merged.parentMid).toBe('u-server')
    expect(merged.branchId).toBe('branch-server')
    expect(merged.createdAt).toBe(100)
  })

  it('后台快照确认后（在途标记清除）后台整体覆盖本地视图', () => {
    const local = assistant('m1', '流式片段', 200)
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })
    clearRuntimeMessageMarker(local)

    const stored = assistant('m1', '完整回复', 900)
    expect(resolveChatMessageFact({ serverMessage: stored, localMessage: local })).toBe(stored)
  })

  it('双方都收敛时以存储事实为准', () => {
    const local = assistant('m1', '本地旧文', 100)
    const stored = assistant('m1', '服务端正文', 200)
    expect(resolveChatMessageFact({ serverMessage: stored, localMessage: local })).toBe(stored)
  })

  it('材料身份不参与本地裁决：后台消息整体覆盖', () => {
    const local = { id: 'm1', type: 'async_tool_result', role: 'assistant', content: '工具结果' } as any
    const stored = assistant('m1', '普通正文', 200)
    expect(resolveChatMessageFact({ serverMessage: stored, localMessage: local })).toBe(stored)
  })
})

describe('消息集合事实优先级：后台决定存留与顺序', () => {
  it('集合成员资格以服务端为准，删掉的消息不因本地旧文档复活', () => {
    const localGone = assistant('m2', '已删除')
    expect(shouldPreserveRuntimeOnlyMessage(localGone)).toBe(false)

    const merged = resolveChatMessageCollectionFact({
      serverMessages: [assistant('m1', '保留')],
      localMessages: [assistant('m1', '本地旧文'), localGone],
    })
    expect(merged.map((message: any) => message.id)).toEqual(['m1'])
    expect(merged[0].content).toBe('保留')
  })

  it('只有回复生成期间的在途临时状态允许补入集合末尾', () => {
    const runtime = assistant('m2', '刚落盘')
    beginAssistantRun(runtime, { generationId: 'run-1', stream: true, resetContent: false })

    const merged = resolveChatMessageCollectionFact({
      serverMessages: [assistant('m1', '历史')],
      localMessages: [runtime],
    })
    expect(merged.map((message: any) => message.id)).toEqual(['m1', 'm2'])
  })

  it('同 id 在途消息不改变后台给定的集合顺序', () => {
    const runtime = assistant('m2', '在途片段')
    beginAssistantRun(runtime, { generationId: 'run-1', stream: true, resetContent: false })

    const merged = resolveChatMessageCollectionFact({
      serverMessages: [assistant('m2', '后台旧页'), assistant('m1', '历史')],
      localMessages: [runtime],
    })
    expect(merged.map((message: any) => message.id)).toEqual(['m2', 'm1'])
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
