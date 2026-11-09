// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatComposer } from './ChatComposer'
import { COMPOSER_TOOL_IDS, normalizeComposerToolsLayout } from '../../domain/composerToolsLayout'

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
  composerToolsLayout: normalizeComposerToolsLayout(undefined),
  activeSessionComposerDraftKey: 'role:role-1:chat-1',
  composerInputRef: { current: null },
  activeTargetKind: 'role' as const,
  activeChatTargetId: 'role-1',
  activeChatId: 'chat-1',
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
  activeContextTokenUsageText: '12k tokens',
  activeContextTokenUsageShortText: '12k',
  activeCacheRateText: '45%',
  activeAsyncToolTaskRunningCount: 2,
  openAsyncToolTasks: () => {},
  activeStreamOn: false,
  chatSettingsStreamSaving: false,
  activeChat: { id: 'chat-1' },
  onSend: () => {},
  onStop: () => {},
  onPaste: () => {},
}

const controller = {
  getComposerDraft: () => ({ input: '', images: [] }),
  getScopeVer: () => 0,
  subscribeScope: () => () => {},
  actions: {
    setComposerInput: () => {},
    removeDraftImage: () => {},
    selectHookPromptForActiveChat: () => {},
    toggleChatStreamEnabled: () => {},
  },
}

function toolbarButtonLabels(host: HTMLElement): string[] {
  const toolbar = host.querySelector('[data-area="composer-toolbar"]')
  if (!toolbar) return []
  return Array.from(toolbar.querySelectorAll('button')).map((node) => {
    const aria = node.getAttribute('aria-label')
    if (aria) return aria
    return String(node.textContent || '').trim()
  })
}

describe('输入区工具条按布局渲染', () => {
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

  const render = (layout: unknown) => {
    act(() => {
      root.render(<ChatComposer {...(baseProps as any)} controller={controller} composerToolsLayout={layout as any} />)
    })
  }

  it('renders only the inline area, in layout order', () => {
    render(
      normalizeComposerToolsLayout({
        inline: ['stream-toggle', 'image-picker'],
        menu: COMPOSER_TOOL_IDS.filter((id) => id !== 'stream-toggle' && id !== 'image-picker'),
      }),
    )

    const labels = toolbarButtonLabels(host!)
    expect(labels).toEqual(['切换会话流式输出', '添加图片', '更多'])
  })

  it('keeps every button out of the toolbar when all of them live in the menu', () => {
    // 真实的全收编状态：每个按钮都登记在菜单里，工具条区刻意留空。
    const layout = normalizeComposerToolsLayout({ inline: [], menu: COMPOSER_TOOL_IDS })
    render(layout)

    const labels = toolbarButtonLabels(host!)
    expect(labels).toEqual(['更多'])
    // 菜单非空时「更多」入口必须存在，否则菜单里的按钮无法触达。
    expect(host!.querySelector('[aria-label="更多"]')).not.toBeNull()
  })

  it('hides the more entry when the menu area is empty', () => {
    render(normalizeComposerToolsLayout({ inline: COMPOSER_TOOL_IDS, menu: [] }))

    const labels = toolbarButtonLabels(host!)
    expect(labels).toContain('添加图片')
    expect(labels).not.toContain('更多')
    expect(host!.querySelector('[aria-label="更多"]')).toBeNull()
  })
})
