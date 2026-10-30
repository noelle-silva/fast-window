import { describe, expect, it, vi } from 'vitest'
import { createChatSessionSettingsBridge } from './chatSessionSettingsBridge'

// 会话级设置的乐观显示：先写视窗，业务端确认后覆盖，失败则精确回滚。
function createHarness(options: { failRequest?: boolean } = {}) {
  const chat: any = { id: 's-1', modelOverride: { kind: 'provider', providerId: 'p-old', groupId: '', modelId: 'm-old' } }
  const state: any = { data: {} }
  const emits: number[] = []
  const toasts: string[] = []
  let applied: any = null

  const bridge = createChatSessionSettingsBridge({
    getState: () => state,
    getNetRequest: () => async () => {
      if (options.failRequest) throw new Error('网络失败')
      return { body: { id: 's-1', modelOverride: { kind: 'provider', providerId: 'p-new', groupId: '', modelId: 'm-new' } } }
    },
    emit: () => { emits.push(1) },
    showToast: (message: any) => { toasts.push(String(message)) },
    runChatSettingsSave: async (_target: any, _action: any, _value: any, work: (isCurrent: () => boolean) => Promise<void>) => {
      try {
        await work(() => true)
        return 'saved' as const
      } catch {
        return false as const
      }
    },
    captureChatSettingsTarget: () => null,
    currentChatForSettingsTarget: () => chat,
    isActiveChatSettingsTarget: () => true,
    upsertWorkspaceChat: () => true,
    upsertLoadedChat: () => true,
  })

  const target: any = { kind: 'role', targetId: 'r-1', roleId: 'r-1', groupId: '', workspaceId: '', sessionId: 's-1', chat }

  async function run() {
    return bridge.applyChatSettingsAction(
      target,
      'model',
      { modelOverride: { kind: 'provider', providerId: 'p-new', groupId: '', modelId: 'm-new' } },
      (current: any) => { current.modelOverride = { kind: 'provider', providerId: 'p-new', groupId: '', modelId: 'm-new' } },
      '保存失败',
    )
  }

  return { chat, state, emits, toasts, run, bridge, target, getApplied: () => applied }
}

describe('会话级设置的乐观显示', () => {
  it('先写视窗再等确认，成功后保持业务端返回的值', async () => {
    const harness = createHarness()
    const result = await harness.run()
    expect(result).toBe('saved')
    expect(harness.chat.modelOverride.modelId).toBe('m-new')
  })

  it('请求失败时回滚到保存前的值', async () => {
    const harness = createHarness({ failRequest: true })
    const result = await harness.run()
    expect(result).toBe(false)
    expect(harness.chat.modelOverride.modelId).toBe('m-old')
  })

  it('回滚只恢复本次字段，不动其它字段', async () => {
    const harness = createHarness({ failRequest: true })
    harness.chat.reasoningEffort = 'high'
    await harness.run()
    expect(harness.chat.modelOverride.modelId).toBe('m-old')
    expect(harness.chat.reasoningEffort).toBe('high')
  })

  it('原字段不存在时回滚为不存在', async () => {
    const harness = createHarness({ failRequest: true })
    delete harness.chat.modelOverride
    await harness.run()
    expect(Object.prototype.hasOwnProperty.call(harness.chat, 'modelOverride')).toBe(false)
  })

  it('乐观显示在请求前就已经写进视窗', async () => {
    const harness = createHarness({ failRequest: true })
    const pending = harness.run()
    // 同步阶段应已应用乐观值。
    expect(harness.chat.modelOverride.modelId).toBe('m-new')
    await pending
  })
})
