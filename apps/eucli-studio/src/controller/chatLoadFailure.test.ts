import { describe, expect, it, vi } from 'vitest'
import {
  chatLoadFailureKey,
  createChatLoadFailureTracker,
  selectChatLoadFailure,
} from './chatLoadFailure'

function createHarness() {
  const state: any = { chatLoadFailures: {} }
  const emit = vi.fn()
  const tracker = createChatLoadFailureTracker({ getState: () => state, emit })
  return { state, emit, tracker }
}

describe('chat load failure tracker', () => {
  // 回归：失败曾存成一个全局值，两个会话并发失败会互相覆盖，
  // 提示挂到错误的目标上。现在每个会话各占一格，互不影响。
  it('并发失败互不覆盖，各自按会话查询', async () => {
    const { state, tracker } = createHarness()

    const first = tracker.track('role', 'role-1', 'chat-a', () => Promise.reject(new Error('A 网络错误')))
    const second = tracker.track('group', 'group-1', 'chat-b', () => Promise.reject(new Error('B 数据损坏')))
    await expect(first).rejects.toThrow('A 网络错误')
    await expect(second).rejects.toThrow('B 数据损坏')

    expect(Object.keys(state.chatLoadFailures)).toHaveLength(2)
    expect(selectChatLoadFailure(state.chatLoadFailures, 'role', 'role-1', 'chat-a')?.reason).toBe('A 网络错误')
    expect(selectChatLoadFailure(state.chatLoadFailures, 'group', 'group-1', 'chat-b')?.reason).toBe('B 数据损坏')
    // 不存在的目标不继承任何别人的失败。
    expect(selectChatLoadFailure(state.chatLoadFailures, 'role', 'role-2', 'chat-c')).toBeNull()
  })

  it('成功只清空自己这一格，别的会话失败保持不变', async () => {
    const { state, tracker } = createHarness()

    await tracker.track('role', 'role-1', 'chat-a', () => Promise.reject(new Error('A 失败'))).catch(() => null)
    await tracker.track('role', 'role-1', 'chat-b', () => Promise.reject(new Error('B 失败'))).catch(() => null)

    await tracker.track('role', 'role-1', 'chat-a', async () => ({ id: 'chat-a' }))

    expect(selectChatLoadFailure(state.chatLoadFailures, 'role', 'role-1', 'chat-a')).toBeNull()
    expect(selectChatLoadFailure(state.chatLoadFailures, 'role', 'role-1', 'chat-b')?.reason).toBe('B 失败')
  })

  it('同一会话重新发起尝试时，旧失败事实立即作废', async () => {
    const { state, tracker } = createHarness()

    await tracker.track('role', 'role-1', 'chat-a', () => Promise.reject(new Error('旧失败'))).catch(() => null)
    expect(selectChatLoadFailure(state.chatLoadFailures, 'role', 'role-1', 'chat-a')?.reason).toBe('旧失败')

    // 重试进入新一轮：开始即清掉旧事实，避免 UI 继续显示上一轮的失败。
    let resolveRun: (value: any) => void = () => {}
    const running = tracker.track('role', 'role-1', 'chat-a', () => new Promise((resolve) => { resolveRun = resolve }))
    expect(selectChatLoadFailure(state.chatLoadFailures, 'role', 'role-1', 'chat-a')).toBeNull()

    resolveRun({ id: 'chat-a' })
    await running
    expect(selectChatLoadFailure(state.chatLoadFailures, 'role', 'role-1', 'chat-a')).toBeNull()
  })

  it('失败原因来自真实错误，缺失时回落到统一文案', async () => {
    const { state, tracker } = createHarness()

    await tracker.track('role', 'role-1', 'chat-a', () => Promise.reject('')).catch(() => null)
    expect(selectChatLoadFailure(state.chatLoadFailures, 'role', 'role-1', 'chat-a')?.reason).toBe('会话加载失败')
  })

  it('键完整表达会话身份（kind + targetId + chatId）', () => {
    expect(chatLoadFailureKey('role', 'role-1', 'chat-a')).not.toBe(chatLoadFailureKey('group', 'role-1', 'chat-a'))
    expect(chatLoadFailureKey('role', 'role-1', 'chat-a')).not.toBe(chatLoadFailureKey('role', 'role-2', 'chat-a'))
    expect(chatLoadFailureKey('role', 'role-1', 'chat-a')).not.toBe(chatLoadFailureKey('role', 'role-1', 'chat-b'))
    expect(chatLoadFailureKey('role', ' role-1 ', ' chat-a ')).toBe(chatLoadFailureKey('role', 'role-1', 'chat-a'))
  })

  it('重复清理不产生多余广播', async () => {
    const { tracker, emit } = createHarness()

    await tracker.track('role', 'role-1', 'chat-a', () => Promise.reject(new Error('失败'))).catch(() => null)
    const afterFailure = emit.mock.calls.length

    tracker.clear('role', 'role-1', 'chat-a')
    const afterClear = emit.mock.calls.length
    expect(afterClear).toBe(afterFailure + 1)

    // 已经空了：再清一次不该广播。
    tracker.clear('role', 'role-1', 'chat-a')
    expect(emit.mock.calls.length).toBe(afterClear)
  })
})
