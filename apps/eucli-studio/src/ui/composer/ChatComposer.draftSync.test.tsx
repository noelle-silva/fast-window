// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatComposer } from './ChatComposer'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const baseProps = {
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
  activeSessionComposerDraftKey: 'role:role-1:new:__new__',
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
  effectiveModelRef: { providerId: 'provider-1', modelId: 'model-1' },
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

function createComposerHarness(initialInput: string) {
  const draft = { input: initialInput, images: [] as any[] }
  const listeners = new Set<() => void>()
  let version = 0
  const controller = {
    getComposerDraft: () => draft,
    getScopeVer: () => version,
    subscribeScope: (_scope: string, listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    actions: {
      setComposerInput: (value: string) => {
        draft.input = String(value ?? '')
      },
      removeDraftImage: () => {},
    },
  }
  return {
    draft,
    controller,
    notifyComposerScope() {
      version += 1
      for (const listener of listeners) listener()
    },
  }
}

describe('输入区与草稿数据同步', () => {
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

  it('用户键入后草稿被外部清空，输入框同步复位', () => {
    const harness = createComposerHarness('')

    act(() => {
      root.render(<ChatComposer {...(baseProps as any)} controller={harness.controller} />)
    })

    const textarea = () => host?.querySelector('textarea') as HTMLTextAreaElement | null
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

    act(() => {
      const el = textarea()
      expect(el).toBeTruthy()
      setter?.call(el, '用户刚输入的内容')
      el?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(textarea()?.value).toBe('用户刚输入的内容')
    expect(harness.draft.input).toBe('用户刚输入的内容')

    act(() => {
      harness.draft.input = ''
      harness.notifyComposerScope()
    })

    expect(textarea()?.value).toBe('')
  })
})
