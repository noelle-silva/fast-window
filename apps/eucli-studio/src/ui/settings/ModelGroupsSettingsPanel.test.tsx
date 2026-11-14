// @vitest-environment happy-dom
//
// 模型组设置面板回归：
//
// controller 对 modelGroups.items 就地新增时数组引用不变。
// 模型组列表由 id 清单驱动渲染，id 清单必须每次从当前数组直接派生，
// 不能以数组引用作为 useMemo 的失效依据，否则新建模型组后列表会停留在旧结果。
//
// 另一条主线是策略：可选项与展示名只能来自业务端的策略清单，
// 客户端既不自带清单，也不改写模型上已保存的策略值。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ModelGroupsSettingsPanel } from './ModelGroupsSettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController() {
  return {
    actions: {
      refreshModelGroups: () => {},
      createModelGroup: () => '',
      saveModelGroups: () => {},
      moveModelGroup: () => {},
    },
  } as any
}

const BOX_STRATEGIES = [
  { value: 'sequential', label: '顺序轮询', description: '按成员顺序轮流使用，均摊负载' },
  { value: 'weighted_random', label: '权重随机', description: '按成员权重随机抽取' },
  { value: 'fallback', label: '故障转移', description: '始终从第一位开始，失败才顺位换下一个' },
]

describe('模型组设置面板列表刷新', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  function renderPanel(items: any[], controller: any, panelBox: Record<string, any> = {}) {
    act(() => {
      root.render(
        <ModelGroupsSettingsPanel
          controller={controller}
          loading={false}
          modelGroups={{ items, ...panelBox }}
          providers={[]}
        />,
      )
    })
  }

  // 下拉打开后选项被 MUI 渲染到 body 的 portal 里，只能从 document 上读。
  function openStrategyOptions() {
    const trigger = host!.querySelector('[role="combobox"]') as HTMLElement | null
    expect(trigger).toBeTruthy()
    act(() => {
      trigger!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    return Array.from(document.querySelectorAll('[role="option"]')).map((el) => String(el.textContent || '').trim())
  }

  it('同一 items 数组就地新增模型组后，重渲染立即显示新模型组', () => {
    const controller = createController()
    const items: any[] = [{ id: 'mg1', name: '模型组甲', models: [] }]

    renderPanel(items, controller)
    expect(host!.textContent).toContain('模型组甲')

    act(() => {
      items.push({ id: 'mg2', name: '模型组乙', models: [] })
    })
    renderPanel(items, controller)

    expect(host!.textContent).toContain('模型组甲')
    expect(host!.textContent).toContain('模型组乙')
  })

  function panelModel(overrides: any = {}) {
    return { id: 'deepseek', name: 'deepseek', strategy: 'sequential', supportsReasoning: false, members: [], ...overrides }
  }

  it('对外模型卡片保留全部设置项，并按「身份 / 运行 / 成员」分组呈现', () => {
    const controller = createController()

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel()] }], controller)

    const text = host!.textContent || ''
    expect(text).toContain('对外模型 ID')
    expect(text).not.toContain('显示名称')
    expect(text).toContain('策略')
    expect(text).toContain('可推理')
    expect(text).toContain('成员模型')
    expect(text).toContain('添加成员')
  })

  it('默认思考字段只在开启可推理后出现', () => {
    const controller = createController()
    // 提示文案里也含「默认思考」四个字，判断字段存在性要看标签节点。
    const hasDefaultReasoningSelect = () => Array.from(host!.querySelectorAll('label')).some((el) => el.textContent === '默认思考')

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel()] }], controller)
    expect(hasDefaultReasoningSelect()).toBe(false)

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel({ supportsReasoning: true })] }], controller)
    expect(hasDefaultReasoningSelect()).toBe(true)
  })

  it('对外模型不再读取旧数据里的名称', () => {
    const controller = createController()

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel({ name: '旧名字' })] }], controller)

    const inputValues = Array.from(host!.querySelectorAll('input')).map((el) => (el as HTMLInputElement).value)
    expect(inputValues).toContain('deepseek')
    expect(host!.textContent).not.toContain('旧名字')
  })

  it('策略下拉的可选项来自业务端清单，包含客户端原本不认识的新策略', () => {
    const controller = createController()

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel({ strategy: 'fallback' })] }], controller, { strategies: BOX_STRATEGIES })

    expect(openStrategyOptions()).toEqual(['顺序轮询', '权重随机', '故障转移'])
  })

  it('模型卡片的策略名与说明取自清单，不再写死分支', () => {
    const controller = createController()

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel({ strategy: 'fallback' })] }], controller, { strategies: BOX_STRATEGIES })

    const text = host!.textContent || ''
    expect(text).toContain('故障转移')
    expect(text).toContain('始终从第一位开始，失败才顺位换下一个')
    // 卡片摘要只显示当前策略，不会被渲染成别的一档。
    expect(text).not.toContain('顺序轮询')
  })

  it('清单里没有的已保存策略值原样显示，不被改写成顺序轮询', () => {
    const controller = createController()

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel({ strategy: 'brand_new' })] }], controller, { strategies: BOX_STRATEGIES })

    const text = host!.textContent || ''
    expect(text).toContain('brand_new')
    expect(text).not.toContain('顺序轮询')
  })

  it('清单为空时只显示已保存的策略值，不伪造任何选项', () => {
    const controller = createController()

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel({ strategy: 'fallback' })] }], controller, { strategies: [], strategiesFetchedAt: Date.now() })

    const text = host!.textContent || ''
    expect(text).toContain('fallback')
    expect(text).not.toContain('顺序轮询')
    expect(text).not.toContain('权重随机')
    expect(text).toContain('业务端没有返回可用策略')
  })

  it('还没取过策略清单时不提前报空', () => {
    const controller = createController()

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel({ strategy: 'fallback' })] }], controller, { strategies: [] })

    expect(host!.textContent).not.toContain('业务端没有返回可用策略')
    expect(host!.textContent).toContain('fallback')
  })

  it('策略清单加载失败时说清原因，而不是假装选项还在', () => {
    const controller = createController()

    renderPanel([{ id: 'mg1', name: '模型组甲', models: [panelModel()] }], controller, { strategies: [], strategiesError: 'HTTP 500' })

    expect(host!.textContent).toContain('策略清单加载失败：HTTP 500')
  })
})
