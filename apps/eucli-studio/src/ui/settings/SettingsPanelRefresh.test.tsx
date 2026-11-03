// @vitest-environment happy-dom
//
// 设置面板刷新行为：
// - 注册表里声明的每个地址都必须真正驱动对应面板宿主重渲染；
// - 无关地址不得让别的面板跟着重渲染；
// - 供应商新建、群组“当前”标记这类回归必须由真实面板验证。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { SETTINGS_NAVIGATION_VALUES } from '../../domain/settingsNavigation'
import { SETTINGS_PANEL_REFRESH_SCOPES } from '../../domain/settingsRefreshScopes'
import { createUiCore } from '../uiCore'
import { SettingsPanelHost } from './SettingsPanelHost'
import { ProvidersSettingsPanel } from './ProvidersSettingsPanel'
import { GroupsSettingsPanel } from './GroupsSettingsPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function createController(state: any) {
  const uiCore = createUiCore()
  return {
    uiCore,
    controller: {
      getState: () => state,
      getScopeVer: (scope: string) => uiCore.getScopeVer(scope),
      subscribeScope: (scope: string, fn: () => void) => uiCore.subscribeScope(scope, fn),
      actions: {},
    } as any,
  }
}

function createBaseState() {
  return {
    loading: false,
    data: {
      roles: [],
      groups: [],
      workspaces: [],
      settings: {
        providers: [],
        settingsNavOrder: [],
      },
      ui: {},
    },
    draft: {},
    modelGroups: { items: [] },
    models: { loading: false, error: '', items: [] },
    tools: { items: [] },
    toolWorkDirectory: null,
    modelRequestConfig: null,
    conversationImageConfig: null,
    requestRecords: null,
    accessSettings: null,
    hookPrompts: { loading: false, error: '', library: { presets: [] } },
    placeholders: { loading: false, error: '', library: { placeholders: [], folders: [] }, preview: { text: '', problems: [] }, problems: [], dependencyTree: { name: '' } },
    systemPlugins: { loading: false, error: '', items: [], selectedPluginId: '', selectedPlugin: null, availableInterfaces: [] },
  } as any
}

describe('设置面板自订阅', () => {
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

  for (const tab of SETTINGS_NAVIGATION_VALUES) {
    const scopes = SETTINGS_PANEL_REFRESH_SCOPES[tab]
    if (!scopes.length) continue

    it(`${tab}：注册表里的每个地址都会驱动面板宿主重渲染`, () => {
      const state = createBaseState()
      const { controller, uiCore } = createController(state)
      let renders = 0

      act(() => {
        root.render(
          <SettingsPanelHost
            controller={controller}
            tab={tab}
            render={() => {
              renders += 1
              return <span>{renders}</span>
            }}
          />,
        )
      })

      const initial = renders
      expect(initial).toBeGreaterThan(0)

      let expected = initial
      for (const scope of scopes) {
        act(() => uiCore.emitScope(scope))
        expected += 1
        expect(renders, `${tab} 没有响应 ${scope}`).toBeGreaterThanOrEqual(expected)
        expected = renders
      }
    })
  }

  it('无关地址只刷新对应面板', () => {
    const state = createBaseState()
    const { controller, uiCore } = createController(state)
    const renders = { providers: 0, groups: 0 }

    act(() => {
      root.render(
        <>
          <SettingsPanelHost controller={controller} tab="providers" render={() => { renders.providers += 1; return null }} />
          <SettingsPanelHost controller={controller} tab="groups" render={() => { renders.groups += 1; return null }} />
        </>,
      )
    })
    expect(renders).toEqual({ providers: 1, groups: 1 })

    act(() => uiCore.emitScope(refreshScopes.entities('providers')))
    expect(renders).toEqual({ providers: 2, groups: 1 })
  })

  it('供应商新建后列表立即显示，不依赖父级 memo 重建', () => {
    const state = createBaseState()
    state.data.settings.providers.push({ id: 'p1', name: '供应商甲', protocol: 'openai', baseUrl: 'http://a' })
    const { controller, uiCore } = createController(state)

    act(() => {
      root.render(
        <SettingsPanelHost
          controller={controller}
          tab="providers"
          render={(panelState) => (
            <ProvidersSettingsPanel
              controller={controller}
              loading={panelState.loading}
              providers={panelState.providers}
              draft={panelState.draft}
              models={panelState.models}
            />
          )}
        />,
      )
    })
    expect(host!.textContent).toContain('供应商甲')
    expect(host!.textContent).not.toContain('供应商乙')

    act(() => {
      state.data.settings.providers.push({ id: 'p2', name: '供应商乙', protocol: 'anthropic', baseUrl: 'http://b' })
      uiCore.emitScope(refreshScopes.entities('providers'))
    })

    expect(host!.textContent).toContain('供应商甲')
    expect(host!.textContent).toContain('供应商乙')
  })

  it('群组导航变化后“当前”标记立即移动', () => {
    const state = createBaseState()
    state.data.groups = [
      { id: 'g1', name: '甲组', memberRoleIds: [] },
      { id: 'g2', name: '乙组', memberRoleIds: [] },
    ]
    state.data.roles = [{ id: 'r1', name: '角色一' }]
    state.draft.activeTargetKind = 'group'
    state.draft.activeGroupId = 'g1'
    const { controller, uiCore } = createController(state)

    act(() => {
      root.render(
        <SettingsPanelHost
          controller={controller}
          tab="groups"
          render={(panelState) => (
            <GroupsSettingsPanel
              controller={controller}
              loading={panelState.loading}
              groups={panelState.groups}
              roles={panelState.roles}
              draft={panelState.draft}
              activeGroupId={panelState.activeGroupId}
              activeTargetKind={panelState.activeTargetKind}
            />
          )}
        />,
      )
    })

    expect(host!.textContent).toContain('甲组 · 当前')
    expect(host!.textContent).not.toContain('乙组 · 当前')

    act(() => {
      state.draft.activeGroupId = 'g2'
      uiCore.emitScope(refreshScopes.navigation())
    })

    expect(host!.textContent).toContain('乙组 · 当前')
    expect(host!.textContent).not.toContain('甲组 · 当前')
  })
})
