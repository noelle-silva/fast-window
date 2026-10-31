import { describe, expect, it } from 'vitest'
import { mergeChatFromStorage } from './chatStorageSync'
import { ASSISTANT_RUNNING_CONTENT, beginAssistantRun, finishAssistantRun } from './assistantRunState'

// 回归：终态后「最终消息不丢失」。
//
// 现场故障：回复完成后内容消失，只剩「生成中（流式）」占位。
// 原因是终态刷新与落盘并发，刷新读到的是保存前的页；旧合并规则把
// 「已不再生成」的本地最终回复当成可丢弃的瞬时态，于是它被旧页覆盖掉。

function chat(messages: any[], status = 'running') {
  return {
    id: 'chat-1',
    status,
    updatedAt: 100,
    branching: { schemaVersion: 1, activeBranchId: 'main', branches: [{ id: 'main', name: '主线', headMid: '', createdAt: 1, updatedAt: 100, forkFromMid: '' }] },
    messages,
  }
}

function user(id: string) {
  return { id, role: 'user', type: 'user', content: id, branchId: 'main', parentMid: '', createdAt: 1, updatedAt: 1 } as any
}

function storedAssistant(id: string, content: string, createdAt = 2) {
  return { id, role: 'assistant', type: 'assistant', content, branchId: 'main', parentMid: 'u1', createdAt, updatedAt: createdAt } as any
}

describe('终态刷新不丢最终回复', () => {
  it('本地最终回复（已收敛）不被「保存前旧页」的占位覆盖', () => {
    // 本地：运行期独占的最终回复已经收敛。
    const local = storedAssistant('m2', '完整回复')
    local.runtimeOnly = true
    local.updatedAt = 500
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })
    finishAssistantRun(local, '完整回复', 'succeeded', 500)

    // 存储：并发读到的旧页仍是占位文案。
    const current = chat([user('u1'), local], 'running')
    const next = chat([user('u1'), storedAssistant('m2', ASSISTANT_RUNNING_CONTENT)], 'running')

    const merged = mergeChatFromStorage(next, current)
    const mergedAssistant = merged.messages.find((m: any) => m.id === 'm2')

    expect(mergedAssistant.content).toBe('完整回复')
  })

  it('存储已含最终回复时以存储为准（不保留本地运行期身份）', () => {
    const local = storedAssistant('m2', '流式中的片段')
    local.runtimeOnly = true
    local.updatedAt = 200
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

    const current = chat([user('u1'), local])
    const next = chat([user('u1'), storedAssistant('m2', '完整回复', 900)], 'completed')

    const merged = mergeChatFromStorage(next, current)
    expect(merged.messages.find((m: any) => m.id === 'm2').content).toBe('完整回复')
  })

  it('存储里根本没有该消息时，运行期独占的最终回复被保留', () => {
    const local = storedAssistant('m3', '刚落盘的回复')
    local.runtimeOnly = true
    local.updatedAt = 500
    finishAssistantRun(local, '刚落盘的回复', 'succeeded', 500)

    const current = chat([user('u1'), local])
    const next = chat([user('u1')])

    const merged = mergeChatFromStorage(next, current)
    expect(merged.messages.map((m: any) => m.id)).toEqual(['u1', 'm3'])
  })

  it('非运行期消息缺席存储时不被保留（删除不复活）', () => {
    const stale = storedAssistant('m2', '已删除的消息')
    // 没有 runtimeOnly：它来自存储，删除后不应被本地捞回来。
    const current = chat([user('u1'), stale])
    const next = chat([user('u1')])

    const merged = mergeChatFromStorage(next, current)
    expect(merged.messages.map((m: any) => m.id)).toEqual(['u1'])
  })
})
