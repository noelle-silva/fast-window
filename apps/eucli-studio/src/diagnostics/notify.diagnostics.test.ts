import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectChatIds,
  evaluateScopeIsolation,
  evaluateSwitchSample,
  installNotifyDiagnostics,
  isNotifyReportOk,
  normalizeNotifyIterations,
  normalizeNotifyScenario,
  normalizeSwitchSettleMs,
  readNotifyBox,
  resolveNotifyTarget,
  type NotifySwitchSample,
} from './notify.diagnostics'
import { recordRender } from './renderProbe'

function switchSample(overrides: Partial<NotifySwitchSample> = {}): NotifySwitchSample {
  return {
    iteration: 1,
    fromChatId: 'chat-a',
    toChatId: 'chat-b',
    changed: true,
    deltaGlobal: 0,
    deltaNavigation: 1,
    deltaChatList: 1,
    ...overrides,
  }
}

describe('collectChatIds', () => {
  it('合并已列出的 meta 与已加载的 chat，保持首次出现顺序并去重', () => {
    const ids = collectChatIds({
      chatMetas: [{ id: 'chat-b' }, { id: ' chat-a ' }, { id: '' }, { id: 'chat-b' }],
      chats: [{ id: 'chat-a' }, { id: 'chat-c' }, null],
    })
    expect(ids).toEqual(['chat-b', 'chat-a', 'chat-c'])
  })

  it('数据盒缺失或列表非法时返回空数组', () => {
    expect(collectChatIds(null)).toEqual([])
    expect(collectChatIds({ chatMetas: 'bad', chats: null })).toEqual([])
  })
})

describe('resolveNotifyTarget', () => {
  it('按 role 读取当前目标与数据盒', () => {
    const box = { activeChatId: 'chat-a', chatMetas: [{ id: 'chat-a' }], chats: [] }
    const target = resolveNotifyTarget({
      draft: { activeTargetKind: 'role', activeRoleId: 'role-a' },
      data: { chatsByRole: { 'role-a': box } },
    })
    expect(target).toEqual({ kind: 'role', targetId: 'role-a', box })
  })

  it('按 group 读取当前目标与数据盒', () => {
    const box = { activeChatId: 'chat-g' }
    const target = resolveNotifyTarget({
      draft: { activeTargetKind: 'group', activeGroupId: 'group-a' },
      data: { chatsByGroup: { 'group-a': box } },
    })
    expect(target).toEqual({ kind: 'group', targetId: 'group-a', box })
  })

  it('workspace 使用 workspaceId::roleId 复合键', () => {
    const box = { activeChatId: 'chat-w' }
    const target = resolveNotifyTarget({
      draft: { activeTargetKind: 'workspace', activeWorkspaceId: 'ws-1', activeRoleId: 'role-a' },
      data: { chatsByWorkspace: { 'ws-1::role-a': box } },
    })
    expect(target).toEqual({ kind: 'workspace', targetId: 'ws-1::role-a', box })
  })

  it('缺少目标身份时给出空 targetId 与空数据盒', () => {
    const target = resolveNotifyTarget({ data: { ui: { activeTargetKind: 'role' } } })
    expect(target).toEqual({ kind: 'role', targetId: '', box: null })
  })
})

describe('readNotifyBox', () => {
  it('按目标种类选择对应数据盒', () => {
    const state = {
      data: {
        chatsByRole: { role: { id: 'role-box' } },
        chatsByGroup: { group: { id: 'group-box' } },
        chatsByWorkspace: { 'ws::role': { id: 'workspace-box' } },
      },
    }
    expect(readNotifyBox(state, 'role', 'role')).toEqual({ id: 'role-box' })
    expect(readNotifyBox(state, 'group', 'group')).toEqual({ id: 'group-box' })
    expect(readNotifyBox(state, 'workspace', 'ws::role')).toEqual({ id: 'workspace-box' })
    expect(readNotifyBox(state, 'role', '')).toBeNull()
  })
})

describe('evaluateSwitchSample', () => {
  it('切换成功且全局增量为 0 时硬指标通过', () => {
    const rows = evaluateSwitchSample(switchSample())
    expect(rows.map((row) => row.result)).toEqual(['PASS', 'PASS', 'INFO', 'INFO'])
    expect(rows[1]).toMatchObject({ metric: 'switch#1.deltaGlobal', actual: 0, budget: 0 })
    expect(isNotifyReportOk(rows)).toBe(true)
  })

  it('切换成功但出现全局广播时硬指标失败', () => {
    const rows = evaluateSwitchSample(switchSample({ deltaGlobal: 2 }))
    expect(rows[1]).toMatchObject({ actual: 2, result: 'FAIL' })
    expect(isNotifyReportOk(rows)).toBe(false)
  })

  it('切换未完成时全局预算标记为 SKIP，切换本身失败', () => {
    const rows = evaluateSwitchSample(switchSample({ changed: false, deltaNavigation: 0, deltaChatList: 0 }))
    expect(rows[0].result).toBe('FAIL')
    expect(rows[1].result).toBe('SKIP')
  })
})

describe('evaluateScopeIsolation', () => {
  const zeroCounts = {
    shell: 0,
    topbar: 0,
    sidebar: 0,
    composer: 0,
    sessionViewport: 0,
    settings: 0,
    overlay: 0,
  }

  it('composer 场景以 scope 版本前进为正向证据，无关表面为 0，渲染计数仅报告', () => {
    const rows = evaluateScopeIsolation('composer', { ...zeroCounts, composer: 1 }, 1)
    expect(rows.map((row) => row.result)).toEqual(['PASS', 'INFO', 'PASS', 'PASS', 'PASS', 'PASS'])
    expect(rows.map((row) => row.metric)).toEqual([
      'composer.scopeVersionDelta',
      'composer.composer.renders',
      'composer.topbar.renders',
      'composer.sidebar.renders',
      'composer.sessionViewport.renders',
      'composer.overlay.renders',
    ])
  })

  it('composer 场景 scope 版本未前进时失败，渲染探针为 0 不再单独判负', () => {
    const rows = evaluateScopeIsolation('composer', { ...zeroCounts, composer: 0, topbar: 2 }, 0)
    expect(rows.find((row) => row.metric === 'composer.scopeVersionDelta')?.result).toBe('FAIL')
    expect(rows.find((row) => row.metric === 'composer.composer.renders')?.result).toBe('INFO')
    expect(rows.find((row) => row.metric === 'composer.topbar.renders')?.result).toBe('FAIL')
  })

  it('settings 场景以 scope 版本前进为正向证据，相关渲染仅报告，overlay 必须为 0', () => {
    const rows = evaluateScopeIsolation('settings', { ...zeroCounts, shell: 1, settings: 1 }, 1)
    expect(rows.map((row) => row.metric)).toEqual([
      'settings.scopeVersionDelta',
      'settings.shell.renders',
      'settings.settings.renders',
      'settings.overlay.renders',
    ])
    expect(rows.map((row) => row.result)).toEqual(['PASS', 'INFO', 'INFO', 'PASS'])

    const overlay = evaluateScopeIsolation('settings', { ...zeroCounts, overlay: 1 }, 1)
    expect(overlay.find((row) => row.metric === 'settings.overlay.renders')?.result).toBe('FAIL')
  })

  it('navigation 场景以 scope 版本前进为正向证据，相关渲染仅报告，overlay 必须为 0', () => {
    const rows = evaluateScopeIsolation('navigation', { ...zeroCounts, topbar: 1, sidebar: 1, sessionViewport: 1 }, 1)
    expect(rows.every((row) => row.result !== 'FAIL')).toBe(true)
    expect(rows.find((row) => row.metric === 'navigation.scopeVersionDelta')?.result).toBe('PASS')
    const overlay = evaluateScopeIsolation('navigation', { ...zeroCounts, overlay: 1 }, 1)
    expect(overlay.find((row) => row.metric === 'navigation.overlay.renders')?.result).toBe('FAIL')
  })
})

describe('参数归一化与报告汇总', () => {
  it('未知场景退化为 all', () => {
    expect(normalizeNotifyScenario('switch')).toBe('switch')
    expect(normalizeNotifyScenario('scope')).toBe('scope')
    expect(normalizeNotifyScenario('unknown')).toBe('all')
    expect(normalizeNotifyScenario(undefined)).toBe('all')
  })

  it('迭代次数有默认值并限制在 1..50', () => {
    expect(normalizeNotifyIterations(undefined)).toBe(3)
    expect(normalizeNotifyIterations(0)).toBe(1)
    expect(normalizeNotifyIterations(2.9)).toBe(2)
    expect(normalizeNotifyIterations(999)).toBe(50)
    expect(normalizeNotifyIterations('bad')).toBe(3)
  })

  it('结算窗口默认 400ms，允许覆盖并限制在 0..1500ms', () => {
    expect(normalizeSwitchSettleMs(undefined)).toBe(400)
    expect(normalizeSwitchSettleMs(0)).toBe(0)
    expect(normalizeSwitchSettleMs(399.9)).toBe(399)
    expect(normalizeSwitchSettleMs(9999)).toBe(1500)
    expect(normalizeSwitchSettleMs('bad')).toBe(400)
  })

  it('SKIP 与 INFO 不算失败，只有 FAIL 让报告失败', () => {
    expect(isNotifyReportOk([
      { scenario: 'switch', metric: 'a', actual: 0, budget: 0, result: 'SKIP' },
      { scenario: 'scope', metric: 'b', actual: 1, budget: 'allowed', result: 'INFO' },
    ])).toBe(true)
    expect(isNotifyReportOk([
      { scenario: 'scope', metric: 'c', actual: 1, budget: 0, result: 'FAIL' },
    ])).toBe(false)
  })
})

function createFakeController(options: { emitScope?: (scope: string) => void } = {}) {
  const box = { activeChatId: 'chat-a', chatMetas: [{ id: 'chat-a' }, { id: 'chat-b' }], chats: [] }
  const state = {
    draft: { activeTargetKind: 'role', activeRoleId: 'role-a' },
    data: { chatsByRole: { 'role-a': box } },
  }
  const versions = new Map<string, number>()
  return {
    box,
    controller: {
      getState: () => state,
      getSnapshot: () => 0,
      getScopeVer: (scope: string) => versions.get(scope) || 0,
      emitScope: (scope: string) => {
        versions.set(scope, (versions.get(scope) || 0) + 1)
        options.emitScope?.(scope)
      },
      actions: {
        setActiveChat: (chatId: string) => {
          box.activeChatId = chatId
        },
      },
    },
  }
}

describe('installNotifyDiagnostics 实机入口最小闭环', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('无 window 环境安装不抛错，switch 会交替切换并恢复原会话', async () => {
    vi.spyOn(console, 'table').mockImplementation(() => {})
    const { box, controller } = createFakeController()
    const diagnostics = installNotifyDiagnostics({ controller })

    expect(diagnostics.report()).toBeNull()
    expect(diagnostics.surfaceCounts().enabled).toBe(false)

    const report = await diagnostics.run({ scenario: 'switch', iterations: 2, settleMs: 0 })

    expect(report.ok).toBe(true)
    expect(report.details.settleMs).toBe(0)
    expect(report.rows.some((row) => row.result === 'FAIL')).toBe(false)
    expect(report.details.switch?.samples).toHaveLength(2)
    expect(report.details.switch?.samples.map((sample) => sample.toChatId)).toEqual(['chat-b', 'chat-a'])
    expect(report.details.switch?.restored).toBe(true)
    expect(box.activeChatId).toBe('chat-a')
    expect(diagnostics.report()).toBe(report)
  })

  it('scope 记录版本增量、相关渲染计数，并在结束后关闭重置 renderProbe', async () => {
    vi.spyOn(console, 'table').mockImplementation(() => {})
    const { controller } = createFakeController({
      emitScope: (scope) => {
        if (scope === 'composer') recordRender('composer')
      },
    })
    const diagnostics = installNotifyDiagnostics({ controller })

    const report = await diagnostics.run({ scenario: 'scope' })

    expect(report.ok).toBe(true)
    expect(report.details.scope?.versions.composer).toEqual({ before: 0, after: 1, delta: 1 })
    expect(report.details.scope?.versions.settings?.delta).toBe(1)
    expect(report.details.scope?.versions.navigation?.delta).toBe(1)
    expect(report.details.scope?.snapshots.composer?.composer).toBe(1)
    expect(report.details.scope?.snapshots.settings?.overlay).toBe(0)
    expect(diagnostics.surfaceCounts().enabled).toBe(false)
    expect(diagnostics.surfaceCounts().counts.composer).toBe(0)
  })
})
