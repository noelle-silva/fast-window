import { describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { createViewerActions } from './viewerActions'

function createHarness() {
  const state: any = {
    draft: { activeRoleId: 'role-a' },
    modal: 'mermaid',
    mermaid: { items: [{ svg: 'a' }, { svg: 'b' }], index: 0, scale: 1 },
    imageViewer: { items: [{ src: 'a' }], index: 0, scale: 1 },
  }
  const emitScope = vi.fn()
  const actions = createViewerActions({
    state,
    emitScope,
    showToast: vi.fn(),
    activeChatFromData: () => null,
    sanitizeSvg: (svg: any) => String(svg || ''),
    currentRenderSafetyPolicy: () => 'original',
    locateMessageInActiveChat: () => null,
    aiFixMermaidInMessage: async () => ({}),
    reloadRoleSession: async () => ({}),
    reloadWorkspaceSession: async () => ({}),
  })
  return { state, actions, emitScope }
}

describe('查看器通知地址', () => {
  it('翻页 / 缩放 / 重置都只通知 uiShell', () => {
    const harness = createHarness()

    harness.actions.mermaidNext()
    harness.actions.mermaidZoom(1)
    harness.actions.mermaidReset()
    harness.actions.imageReset()

    expect(harness.emitScope.mock.calls.length).toBeGreaterThan(0)
    expect(harness.emitScope.mock.calls.every((call) => call[0] === refreshScopes.uiShell())).toBe(true)
  })

  it('Mermaid AI 修复写回正文时通知 session 与 chatList，不动 uiShell', async () => {
    const state: any = {
      draft: { activeRoleId: 'role-a' },
      modal: '',
      mermaid: { items: [], index: 0, scale: 1 },
      imageViewer: { items: [], index: 0, scale: 1 },
    }
    const emitScope = vi.fn()
    const chat = { id: 'session-a1', messages: [{ id: 'm1' }] }
    const actions = createViewerActions({
      state,
      emitScope,
      showToast: vi.fn(),
      activeChatFromData: () => chat,
      sanitizeSvg: (svg: any) => String(svg || ''),
      currentRenderSafetyPolicy: () => 'original',
      locateMessageInActiveChat: () => ({ kind: 'role', targetId: 'role-a', chat, target: chat.messages[0] }),
      aiFixMermaidInMessage: async () => ({ mermaidSource: 'graph TD' }),
      reloadRoleSession: async () => chat,
      reloadWorkspaceSession: async () => chat,
    })

    await actions.aiFixMermaid('m1', 'graph TD', '')

    expect(emitScope).toHaveBeenCalledWith(refreshScopes.session('role', 'role-a', 'session-a1'))
    expect(emitScope).toHaveBeenCalledWith(refreshScopes.chatList('role', 'role-a'))
    expect(emitScope).not.toHaveBeenCalledWith(refreshScopes.uiShell())
  })
})
