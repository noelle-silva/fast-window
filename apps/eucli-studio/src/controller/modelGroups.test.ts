// 模型组策略值只有一个来源：业务端。控制器只负责取回清单、原样保存已保存过的值，
// 这里锁死「不认识的值不被改写成别的策略」以及「清单失败不拖垮模型组清单」。
import { describe, expect, it, vi } from 'vitest'
import { createModelGroupsController, defaultModelGroupsState, normalizeModelGroups } from './modelGroups'

const BOX_STRATEGIES = [
  { value: 'sequential', label: '顺序轮询', description: '按成员顺序轮流使用，均摊负载' },
  { value: 'weighted_random', label: '权重随机', description: '按成员权重随机抽取' },
  { value: 'fallback', label: '故障转移', description: '始终从第一位开始，失败才顺位换下一个' },
]

const BOX_GROUPS = [{ id: 'g1', name: '模型组甲', models: [{ id: 'm1', strategy: 'fallback', members: [] }] }]

type Route = (req: any) => { status: number; body?: any }

function createHarness(routes: Record<string, Route>) {
  const state: any = { modelGroups: defaultModelGroupsState() }
  const netRequest = vi.fn(async (req: any) => {
    const route = routes[`${req.method} ${req.path}`]
    if (!route) throw new Error(`未预期的请求：${req.method} ${req.path}`)
    return route(req)
  })
  const controller = createModelGroupsController({
    getState: () => state,
    netRequest,
    emit: () => {},
    showToast: () => {},
  })
  return { state, netRequest, controller, box: () => state.modelGroups }
}

describe('模型组策略值原样保留', () => {
  it('归一化不改写业务端返回的策略值', () => {
    const groups = normalizeModelGroups([
      { id: 'g1', models: [{ id: 'm1', strategy: 'fallback' }, { id: 'm2', strategy: 'brand_new' }, { id: 'm3' }] },
    ])

    expect(groups[0].models.map((model: any) => model.strategy)).toEqual(['fallback', 'brand_new', ''])
  })

  it('界面改策略时原样存住选中的值，空值不落库', async () => {
    const harness = createHarness({
      'GET /api/model-groups': () => ({ status: 200, body: BOX_GROUPS }),
      'GET /api/model-groups/strategies': () => ({ status: 200, body: BOX_STRATEGIES }),
    })

    await harness.controller.refreshModelGroups(true)
    harness.controller.setModelGroupModelField('g1', 0, 'strategy', 'fallback')
    expect(harness.box().items[0].models[0].strategy).toBe('fallback')

    harness.controller.setModelGroupModelField('g1', 0, 'strategy', 'brand_new')
    expect(harness.box().items[0].models[0].strategy).toBe('brand_new')

    harness.controller.setModelGroupModelField('g1', 0, 'strategy', '  ')
    expect(harness.box().items[0].models[0].strategy).toBe('brand_new')
  })
})

describe('模型组与策略清单同源刷新', () => {
  it('一次刷新同时取回清单与策略，策略整理成下拉选项', async () => {
    const harness = createHarness({
      'GET /api/model-groups': () => ({ status: 200, body: BOX_GROUPS }),
      'GET /api/model-groups/strategies': () => ({ status: 200, body: BOX_STRATEGIES }),
    })

    await harness.controller.refreshModelGroups(true)

    expect(harness.netRequest).toHaveBeenCalledTimes(2)
    expect(harness.box().items).toHaveLength(1)
    expect(harness.box().strategies).toEqual(BOX_STRATEGIES)
    expect(harness.box().strategiesError).toBe('')
  })

  it('策略接口失败不影响模型组清单，失败原因留在状态里', async () => {
    const harness = createHarness({
      'GET /api/model-groups': () => ({ status: 200, body: BOX_GROUPS }),
      'GET /api/model-groups/strategies': () => ({ status: 500, body: { error: { message: 'boom' } } }),
    })

    await harness.controller.refreshModelGroups(true)

    expect(harness.box().items).toHaveLength(1)
    expect(harness.box().error).toBe('')
    expect(harness.box().strategies).toEqual([])
    expect(harness.box().strategiesError).toBe('HTTP 500')
  })

  it('新建对外模型的初始策略取清单第一项；清单还没拿到时留空', async () => {
    const empty = createHarness({})
    empty.controller.createModelGroupModel(empty.controller.createModelGroup())
    expect(empty.box().items[0].models[0].strategy).toBe('')

    const harness = createHarness({
      'GET /api/model-groups/strategies': () => ({ status: 200, body: BOX_STRATEGIES }),
    })
    await harness.controller.refreshModelGroups(true)
    harness.controller.createModelGroupModel(harness.controller.createModelGroup())
    expect(harness.box().items[0].models[0].strategy).toBe('sequential')
  })
})
