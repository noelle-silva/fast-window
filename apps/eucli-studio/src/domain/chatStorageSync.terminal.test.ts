import { describe, expect, it } from 'vitest'
import { mergeChatFromStorage } from './chatStorageSync'
import { setChatBranchHeadMid } from './branching'
import { ASSISTANT_RUNNING_CONTENT, beginAssistantRun, finishAssistantRun } from './assistantRunState'

// 回归：运行期独占标记的覆盖范围。
//
// 标记只覆盖「正在前台生成、尚未被后台快照确认」的消息：
// 在途消息不被保存前的旧页覆盖；一旦生成收敛或后台快照确认，标记立即清除，
// 后续正文与集合成员资格都回到后台事实。

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

describe('运行期独占标记下的正文优先级', () => {
  it('在途消息不被「保存前旧页」的占位覆盖', () => {
    const local = storedAssistant('m2', '完整回复')
    local.updatedAt = 500
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

    // 存储：并发读到的旧页仍是占位文案。
    const current = chat([user('u1'), local], 'running')
    const next = chat([user('u1'), storedAssistant('m2', ASSISTANT_RUNNING_CONTENT)], 'running')

    const merged = mergeChatFromStorage(next, current)
    const mergedAssistant = merged.messages.find((m: any) => m.id === 'm2')

    expect(mergedAssistant.content).toBe('完整回复')
  })

  it('存储已含最终回复时以存储为准（不保留本地运行期身份）', () => {
    const local = storedAssistant('m2', '流式中的片段')
    local.updatedAt = 200
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

    const current = chat([user('u1'), local])
    const next = chat([user('u1'), storedAssistant('m2', '完整回复', 900)], 'completed')

    const merged = mergeChatFromStorage(next, current)
    expect(merged.messages.find((m: any) => m.id === 'm2').content).toBe('完整回复')
  })

  it('存储里根本没有该消息时，带标记的在途回复被保留', () => {
    const local = storedAssistant('m3', '刚落盘的回复')
    local.updatedAt = 500
    beginAssistantRun(local, { generationId: 'run-1', stream: true, resetContent: false })

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
    setChatBranchHeadMid(current, 'main', 'm2', { touchUpdatedAt: false })
    const next = chat([user('u1'), older, newer], 'completed')
    setChatBranchHeadMid(next, 'main', 'm3', { touchUpdatedAt: false })

    const merged = mergeChatFromStorage(next, current)
    expect(merged.branching.branches.find((b: any) => b.id === 'main').headMid).toBe('m3')
  })

  it('存储还没有该消息时，在途运行期头部仍然前推', () => {
    const runtime = storedAssistant('m3', '刚落盘的回复', 500)
    beginAssistantRun(runtime, { generationId: 'run-1', stream: true, resetContent: false })

    const current = chat([user('u1'), runtime])
    setChatBranchHeadMid(current, 'main', 'm3', { touchUpdatedAt: false })
    const next = chat([user('u1')], 'running')
    setChatBranchHeadMid(next, 'main', 'u1', { touchUpdatedAt: false })

    const merged = mergeChatFromStorage(next, current)
    expect(merged.branching.branches.find((b: any) => b.id === 'main').headMid).toBe('m3')
  })
})