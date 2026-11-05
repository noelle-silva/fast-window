import { describe, expect, it } from 'vitest'
import { beginAssistantRun, finishAssistantRun, isAssistantGenerating } from './assistantRunState'
import { mergeChatFromStorage } from './chatStorageSync'
import { isRuntimeMessageInFlight, markRuntimeMessageInFlight } from './runtimeMessageMarker'

function assistant(id: string, content: string, updatedAt = 100) {
  return { id, role: 'assistant', type: 'assistant', content, branchId: 'main', parentMid: '', createdAt: updatedAt, updatedAt } as any
}

function chat(messages: any[], status = 'running') {
  return {
    id: 'chat-1',
    status,
    updatedAt: 100,
    branching: {
      schemaVersion: 1,
      activeBranchId: 'main',
      branches: [{ id: 'main', name: '主线', headMid: '', createdAt: 1, updatedAt: 100, forkFromMid: '' }],
    },
    messages,
  }
}

describe('运行期独占标记生命周期', () => {
  it('进入在途生成时立即建立标记，且不改变已呈现的正文', () => {
    const message = assistant('m1', '已显示的内容')

    beginAssistantRun(message, { generationId: 'run-1', stream: true, resetContent: false })

    expect(isRuntimeMessageInFlight(message)).toBe(true)
    expect(isAssistantGenerating(message)).toBe(true)
    expect(message.content).toBe('已显示的内容')
  })

  it('生成收敛为终态时立即清除标记', () => {
    const message = assistant('m1', '完整回复')
    beginAssistantRun(message, { generationId: 'run-1', stream: true, resetContent: false })

    finishAssistantRun(message, '完整回复', 'succeeded', 200)

    expect(isRuntimeMessageInFlight(message)).toBe(false)
    expect(isAssistantGenerating(message)).toBe(false)
    expect(message.content).toBe('完整回复')
  })

  it('后台快照已收口且包含对应消息时立即清除标记', () => {
    const local = assistant('m1', '在途片段', 200)
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

    mergeChatFromStorage(chat([assistant('m1', '后台正文', 900)], 'completed'), chat([local]))

    expect(isRuntimeMessageInFlight(local)).toBe(false)
  })

  it('后台仍在生成时不提前终结在途遮罩', () => {
    const local = assistant('m1', '在途片段', 200)
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

    mergeChatFromStorage(chat([assistant('m1', '后台旧占位', 100)], 'running'), chat([local]))

    expect(isRuntimeMessageInFlight(local)).toBe(true)
  })

  it('后台状态未知（窗口切片）时不以旧页终结在途遮罩', () => {
    const local = assistant('m1', '在途片段', 200)
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

    mergeChatFromStorage(chat([assistant('m1', '后台旧占位', 100)], ''), chat([local]))

    expect(isRuntimeMessageInFlight(local)).toBe(true)
  })

  it('后台快照未包含对应消息时保留标记', () => {
    const local = assistant('m2', '在途片段', 200)
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

    mergeChatFromStorage(chat([assistant('m1', '历史', 100)]), chat([local]))

    expect(isRuntimeMessageInFlight(local)).toBe(true)
  })

  it('标记写入不依赖异步时序：同一调用栈内即可读写', () => {
    const message = assistant('m1', '正文')

    expect(markRuntimeMessageInFlight(message)).toBe(true)
    expect(isRuntimeMessageInFlight(message)).toBe(true)
  })
})
