// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  disableRenderProbe,
  enableRenderProbe,
  resetRenderProbe,
  snapshotRenderProbe,
} from '../../diagnostics/renderProbe'
import { ComposerSurface } from './ComposerSurface'
import { SidebarSurface } from './SidebarSurface'
import { TopBarSurface } from './TopBarSurface'

vi.mock('../components/ChatTopBar', () => ({
  ChatTopBar: () => null,
}))

vi.mock('../components/ChatSidebar', () => ({
  ChatSidebar: () => null,
}))

vi.mock('../composer/ChatComposer', () => ({
  ChatComposer: () => null,
}))

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const STABLE_PROPS = {
  page: 'chat' as const,
  topbarOpacity: 100,
  topbarBlur: 0,
  standaloneWindowControls: null,
  onTopbarPointerDown: () => {},
  onCloseSettings: () => {},
  nav: {
    canCreateChat: true,
    treeOpen: false,
    chatNav: { olderId: null, newerId: null, lockedReason: '' },
    onOpenFavorites: () => {},
    onOpenRunningSessions: () => {},
    onCreateChat: () => {},
    onToggleTree: () => {},
    onOpenProviders: () => {},
    onOpenSettings: () => {},
    onSwitchChat: () => {},
  },
}

// 模拟 App 侧已 memo 的 effectiveModelRef：引用稳定，ComposerSurface 才能真正跳过。
const STABLE_EFFECTIVE_MODEL_REF = { providerId: 'provider-1', modelId: 'model-1' }

const COMPOSER_STABLE_PROPS = {
  controller: {
    getScopeVer: () => 0,
    subscribeScope: () => () => {},
    getComposerDraft: () => ({ input: '' }),
  },
  loading: false,
  composerRef: { current: null },
  onClickOpenImageViewer: () => {},
  treeOpen: false,
  effectiveTreeView: 'float' as const,
  treePanelW: 0,
  composerOpacity: 86,
  composerBlur: 10,
  composerWidthPercent: 100,
  composerMinRows: 1,
  composerRadius: 16,
  composerModelShowProvider: false,
  activeSessionComposerDraftKey: 'role:role-1:__new__',
  composerInputRef: { current: null },
  activeTargetKind: 'role' as const,
  activeChatTargetId: 'role-1',
  activeChatId: '',
  activeRole: { id: 'role-1' },
  activeGroup: null,
  roles: [],
  activeStopRunId: '',
  formatModelRefText: () => '',
  openImagePicker: () => {},
  hookPrompts: { library: { presets: [] } },
  activeHookPromptMode: 'inherit' as const,
  activeHookPromptPresetId: '',
  roleDefaultHookPromptPresetId: '',
  hookPromptSelectorDisabled: false,
  chatSettingsHookSaving: false,
  hookPromptSelectorDisabledReason: '',
  roleSessionControlsEnabled: true,
  hasChatOverride: false,
  effectiveModelId: 'model-1',
  effectiveModelRef: STABLE_EFFECTIVE_MODEL_REF,
  openTempModelPicker: () => {},
  roleModelStepPrevEnabled: false,
  roleModelStepNextEnabled: false,
  stepRoleModelCandidate: () => {},
  providers: [],
  modelGroups: [],
  reasoningProfile: { supportsReasoning: false, defaultReasoningEffort: '' },
  activeReasoningLabel: '',
  chatSettingsReasoningSaving: false,
  openReasoningPicker: () => {},
  hasChatReasoningOverride: false,
  activeContextTokenUsageText: '',
  activeContextTokenUsageShortText: '',
  activeCacheRateText: '',
  activeAsyncToolTaskRunningCount: 0,
  openAsyncToolTasks: () => {},
  activeStreamOn: false,
  chatSettingsStreamSaving: false,
  activeChat: { id: '' },
  onSend: () => {},
  onStop: () => {},
  onPaste: () => {},
}

describe('Surface 渲染预算', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    enableRenderProbe()
    resetRenderProbe()
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
    disableRenderProbe()
    resetRenderProbe()
  })

  it('稳定 props 下父级本地状态重渲染时 Surface 渲染次数为 0', () => {
    let bump: (() => void) | null = null

    function Parent() {
      const [n, setN] = React.useState(0)
      bump = () => setN((value) => value + 1)
      return (
        <div data-n={n}>
          <TopBarSurface {...STABLE_PROPS} />
        </div>
      )
    }

    act(() => {
      root.render(<Parent />)
    })
    expect(snapshotRenderProbe().counts.topbar).toBe(1)

    act(() => {
      bump?.()
      bump?.()
    })
    expect(snapshotRenderProbe().counts.topbar).toBe(1)
  })

  it('SidebarSurface 只在 navigationVersion 变化时重渲染', () => {
    act(() => {
      root.render(<SidebarSurface {...({ navigationVersion: 0 } as any)} />)
    })
    expect(snapshotRenderProbe().counts.sidebar).toBe(1)

    act(() => {
      root.render(<SidebarSurface {...({ navigationVersion: 0 } as any)} />)
    })
    expect(snapshotRenderProbe().counts.sidebar).toBe(1)

    act(() => {
      root.render(<SidebarSurface {...({ navigationVersion: 1 } as any)} />)
    })
    expect(snapshotRenderProbe().counts.sidebar).toBe(2)
  })

  it('ComposerSurface 在 effectiveModelRef 稳定时不受父级本地状态影响', () => {
    let bump: (() => void) | null = null

    function Parent() {
      const [n, setN] = React.useState(0)
      bump = () => setN((value) => value + 1)
      return (
        <div data-n={n}>
          <ComposerSurface {...(COMPOSER_STABLE_PROPS as any)} />
        </div>
      )
    }

    act(() => {
      root.render(<Parent />)
    })
    expect(snapshotRenderProbe().counts.composer).toBe(1)

    act(() => {
      bump?.()
      bump?.()
    })
    expect(snapshotRenderProbe().counts.composer).toBe(1)
  })
})
