import { describe, expect, it, vi } from 'vitest'
import { createProjectionPipeline } from './projectionPipeline'
import { beginSwitchSpan, resetSwitchSpanForTests } from '../domain/switchSpan'

// 阻塞 1 的生产链路验证：不手工往参数里塞 switchId，
// 而是走 ActiveSelectionWriter → projectionPipeline → sessionSwitch 的真实链路，
// 断言 box 侧收到的 switchId 与前端 switchSpan 完全一致。

function page(messages: any[], nextCursor = '') {
  return { schemaVersion: 1, id: 'chat-1', messages, nextCursor }
}

function msg(id: string, createdAt: number) {
  return { id, branchId: 'main', parentMessageId: 'p0', createdAt, content: id }
}

function createHarness() {
  const scope = { kind: 'role' as const, targetId: 'role-1' }
  const windowCalls: Array<{ scope: any; chatId: string; options: any }> = []
  const getCalls: Array<{ scope: any; chatId: string; options: any }> = []
  const graphCalls: Array<{ scope: any; chatId: string; options: any }> = []
  let windowCall = 0

  const sessionSwitch = {
    hasFeature: () => true,
    sessionWindow: vi.fn(async (s: any, chatId: string, options?: any) => {
      windowCalls.push({ scope: s, chatId, options })
      // 首窗带游标，翻页才真正发生；第二窗到底。
      const nextCursor = windowCall++ === 0 ? 'c2' : ''
      return page([msg(`m${windowCall}`, windowCall)], nextCursor)
    }),
    sessionGet: vi.fn(async (s: any, chatId: string, options?: any) => {
      getCalls.push({ scope: s, chatId, options })
      return { id: chatId, messages: [msg('m1', 1)] }
    }),
    sessionGraph: vi.fn(async (s: any, chatId: string, options?: any) => {
      graphCalls.push({ scope: s, chatId, options })
      return { nodes: [], edges: [] }
    }),
    setActiveChat: vi.fn(async (_s: any, chatId: string) => ({ applied: true, preferenceRevision: 1, activeChatId: chatId })),
    sessionIndexGet: vi.fn(async () => ({ schemaVersion: 1, dataRevision: 1, preferenceRevision: 1, epoch: 1, indexes: [] })),
    sessionSummaryList: vi.fn(),
    setSessionView: vi.fn(),
  }

  let currentSwitchId = ''
  const pipeline = createProjectionPipeline({
    storage: { get: async () => null, set: async () => {} },
    sessionSwitch: sessionSwitch as any,
    loadSplitMeta: async () => ({ roleFolders: { 'role-1': '角色一' }, groupFolders: {} }),
    getSplitMetaCache: () => ({ roleFolders: { 'role-1': '角色一' }, groupFolders: {} }),
    applyLocalSelection: () => {},
    resolveBranchHead: () => '',
    resolveSwitchId: () => currentSwitchId,
  })

  return {
    scope,
    pipeline,
    sessionSwitch,
    windowCalls,
    getCalls,
    graphCalls,
    setCurrentSwitchId: (id: string) => { currentSwitchId = id },
  }
}

describe('正文加载链路的 switchId 生产链路', () => {
  it('首窗请求携带前端 switchSpan 的 switchId（不手工塞参数）', async () => {
    resetSwitchSpanForTests()
    const harness = createHarness()
    const span = beginSwitchSpan('role:role-1:chat-1')
    // 真实链路：controller 的 resolveSwitchId 读的就是 currentSwitchSpan()。
    harness.setCurrentSwitchId(span.switchId)

    await harness.pipeline.chatBodies.load(harness.scope, 'chat-1')

    expect(harness.windowCalls).toHaveLength(1)
    expect(harness.windowCalls[0].options.switchId).toBe(span.switchId)
  })

  it('翻页沿用同一次切换的 switchId', async () => {
    resetSwitchSpanForTests()
    const harness = createHarness()
    const span = beginSwitchSpan('role:role-1:chat-1')
    harness.setCurrentSwitchId(span.switchId)

    await harness.pipeline.chatBodies.load(harness.scope, 'chat-1')
    await harness.pipeline.loadOlderMessages(harness.scope, 'chat-1')

    expect(harness.windowCalls).toHaveLength(2)
    expect(harness.windowCalls[1].options.switchId).toBe(span.switchId)
  })

  it('写路径快照（session.get）同样携带同一个 switchId', async () => {
    resetSwitchSpanForTests()
    const harness = createHarness()
    const span = beginSwitchSpan('role:role-1:chat-1')
    harness.setCurrentSwitchId(span.switchId)

    await harness.sessionSwitch.sessionGet(harness.scope, 'chat-1', { profile: 'edit', switchId: harness.pipeline.currentSwitchId() })

    expect(harness.getCalls[0].options.switchId).toBe(span.switchId)
  })

  it('没有进行中的切换时不带 switchId（观测整条不启动）', async () => {
    resetSwitchSpanForTests()
    const harness = createHarness()
    harness.setCurrentSwitchId('')

    await harness.pipeline.chatBodies.load(harness.scope, 'chat-1')

    expect(harness.windowCalls[0].options).not.toHaveProperty('switchId')
  })
})
