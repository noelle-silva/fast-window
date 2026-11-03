// @vitest-environment happy-dom
//
// 供应商列表刷新回归：
// controller 对 providers 数组就地修改（unshift / 改字段），数组引用不变。
// 面板必须每次渲染直接从当前数组派生编号清单，不得以数组引用作为记忆化依据，
// 否则新建/修改供应商后列表会停留在旧结果。
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NEW_PROVIDER_ID } from '../../domain/constants'
import { ProvidersSettingsPanel } from './ProvidersSettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController() {
  return {
    actions: {
      createProvider: () => {},
      openProviderEditor: () => {},
      saveProvider: () => {},
      askDeleteProvider: () => {},
      moveProvider: () => {},
    },
  } as any
}

describe('供应商设置面板列表刷新', () => {
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

  function renderPanel(providers: any[], controller: any, draft: any = {}) {
    act(() => {
      root.render(
        <ProvidersSettingsPanel controller={controller} loading={false} providers={providers} draft={draft} models={null} />,
      )
    })
  }

  it('同一 providers 数组就地新增供应商后，重渲染立即显示新供应商', () => {
    const controller = createController()
    const providers: any[] = [{ id: 'p1', name: '供应商甲', protocol: 'openai', baseUrl: 'http://a' }]

    renderPanel(providers, controller)
    expect(host!.textContent).toContain('供应商甲')

    act(() => {
      providers.push({ id: 'p2', name: '供应商乙', protocol: 'anthropic', baseUrl: 'http://b' })
    })
    renderPanel(providers, controller)

    expect(host!.textContent).toContain('供应商甲')
    expect(host!.textContent).toContain('供应商乙')
  })

  it('同一供应商对象就地改名后，重渲染立即显示新名称', () => {
    const controller = createController()
    const provider = { id: 'p1', name: '旧名称', protocol: 'openai', baseUrl: 'http://a' }
    const providers: any[] = [provider]

    renderPanel(providers, controller)
    expect(host!.textContent).toContain('旧名称')

    act(() => {
      provider.name = '新名称'
    })
    renderPanel(providers, controller)

    expect(host!.textContent).toContain('新名称')
    expect(host!.textContent).not.toContain('旧名称')
  })

  it('新建草稿态右侧渲染编辑器，列表不出现未保存的幽灵行', () => {
    const controller = createController()
    const providers: any[] = [{ id: 'p1', name: '供应商甲', protocol: 'openai', baseUrl: 'http://a' }]

    renderPanel(providers, controller, {
      editProviderId: NEW_PROVIDER_ID,
      providerName: '新供应商（OpenAI 兼容）',
      providerBaseUrl: 'http://',
      providerProtocol: '',
      providerApiKeyStrategy: 'sequential',
      providerApiKeys: [],
      providerRegisteredModels: [],
    })

    expect(host!.textContent).toContain('供应商甲')
    expect(host!.textContent).not.toContain('新供应商（OpenAI 兼容）')
    expect(host!.textContent).toContain('供应商 Key')
    expect(host!.textContent).not.toContain('选择一个供应商查看和编辑')

    const saveButton = Array.from(host!.querySelectorAll('button')).find((button) => button.textContent?.trim() === '保存')
    expect(saveButton?.disabled).toBe(false)
    const deleteButton = host!.querySelector('button[aria-label="更多操作"]') as HTMLButtonElement | null
    expect(deleteButton).not.toBeNull()
    expect(deleteButton?.disabled).toBe(true)
  })
})
