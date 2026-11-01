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

// 回归：分支头只能往前推。
//
// 现场故障：点「重新回答」或从某个节点继续发送后，回复完成会被重载回上一轮节点。
// 原因是合并时用「本地运行期独占的旧头」覆盖了存储里已经更新的分支头，
// 于是每次重载都把视图拉回旧的叶子。
describe('分支头只前进不后退', () => {
  it('存储里的分支头更新时，不被本地运行期旧头覆盖', () => {
    const older = storedAssistant('m2', '上一轮回复', 200)
    older.runtimeOnly = true
    finishAssistantRun(older, '上一轮回复', 'succeeded', 200)
    const newer = storedAssistant('m3', '本轮新回复', 500)

    const current = chat([user('u1'), older, newer])
    current.branching.branches[0].headMid = 'm2'
    const next = chat([user('u1'), older, newer], 'completed')
    next.branching.branches[0].headMid = 'm3'

    const merged = mergeChatFromStorage(next, current)
    expect(merged.branching.branches.find((b: any) => b.id === 'main').headMid).toBe('m3')
  })

  it('存储还没有该消息时，运行期头部仍然前推', () => {
    const runtime = storedAssistant('m3', '刚落盘的回复', 500)
    runtime.runtimeOnly = true
    finishAssistantRun(runtime, '刚落盘的回复', 'succeeded', 500)

    const current = chat([user('u1'), runtime])
    current.branching.branches[0].headMid = 'm3'
    const next = chat([user('u1')], 'running')
    next.branching.branches[0].headMid = 'u1'

    const merged = mergeChatFromStorage(next, current)
    expect(merged.branching.branches.find((b: any) => b.id === 'main').headMid).toBe('m3')
  })
})