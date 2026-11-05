// 工作区图标的保存语义：
// 图标是独立资源，保存工作区时按「草稿 vs 基线」决定不写 / 写入 / 删除；
// 图标写失败如实上报，不把「工作区已保存」当成功收尾。
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceManager } from './workspaceManager'

const SVG_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>'

type Call = { method: string; path: string; body?: any }

function createHarness(options: { initialIcon?: any; failIconWrite?: boolean } = {}) {
  const calls: Call[] = []
  let iconState = options.initialIcon ?? null
  const state: any = {
    loading: false,
    draft: { activeTargetKind: 'workspace', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: 'ws-1' },
    data: {
      roles: [{ id: 'role-a', name: '角色A' }],
      workspaces: [
        {
          id: 'ws-1',
          name: '工作区一',
          directories: [],
          prompt: '',
          registeredRoleIds: ['role-a'],
          actualPrompt: '',
          icon: options.initialIcon ?? null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      chatsByRole: {},
      chatsByGroup: {},
      chatsByWorkspace: {},
      ui: { activeTargetKind: 'workspace', activeRoleId: 'role-a', activeGroupId: '', activeWorkspaceId: 'ws-1' },
    },
  }
  const iconPath = '/api/workspaces/ws-1/icon'
  const netRequest = vi.fn(async (req: any) => {
    calls.push({ method: req.method, path: req.path, body: req.body })
    if (req.method === 'GET' && req.path === '/api/workspaces') return { status: 200, body: [{ id: 'ws-1' }] }
    if (req.method === 'GET' && req.path === '/api/workspaces/ws-1') {
      return {
        status: 200,
        body: {
          id: 'ws-1',
          name: String(state.draft.workspaceName || '工作区一'),
          directories: [],
          prompt: '',
          registeredRoleIds: ['role-a'],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      }
    }
    if (req.method === 'GET' && req.path === iconPath) {
      if (!iconState) return { status: 404, body: { error: { code: 'storage.not_found' } } }
      return { status: 200, body: iconState }
    }
    if (req.method === 'PUT' && req.path === iconPath) {
      if (options.failIconWrite) throw new Error('图标通道不可用')
      iconState = req.body
      return { status: 204 }
    }
    if (req.method === 'DELETE' && req.path === iconPath) {
      iconState = null
      return { status: 204 }
    }
    if (req.method === 'POST' && req.path === '/api/workspaces') return { status: 204 }
    throw new Error(`未预期的请求：${req.method} ${req.path}`)
  })
  const closeModal = vi.fn()
  const showToast = vi.fn()
  const manager = createWorkspaceManager({
    getState: () => state,
    netRequest,
    emit: vi.fn(),
    emitScope: vi.fn(),
    closeModal,
    saveMeta: async () => {},
    scrollToBottomSoon: vi.fn(),
    showToast,
    shrinkImageDataUrl: async (dataUrl: string) => dataUrl,
    activeTargetKind: () => String(state.draft.activeTargetKind || 'role'),
    activeRole: () => state.data.roles[0] || null,
    activeWorkspace: () => state.data.workspaces[0] || null,
    clearPendingWorkspaceChat: () => {
      state.pendingWorkspaceChat = null
    },
    cleanupFavoriteRefsForTarget: () => {},
  })
  return {
    state,
    manager,
    calls,
    icon: () => iconState,
    closeModal,
    showToast,
    iconWrites: () => calls.filter((call) => call.path === iconPath && call.method !== 'GET'),
  }
}

describe('工作区图标保存', () => {
  it('粘贴 SVG 后保存：工作区先落盘，图标随后写入', async () => {
    const harness = createHarness()
    harness.manager.openWorkspaceEditor('ws-1')
    harness.manager.setWorkspaceIconSvg(SVG_ICON)

    await harness.manager.saveWorkspaceEditor()

    const writes = harness.iconWrites()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toEqual({ method: 'PUT', path: '/api/workspaces/ws-1/icon', body: { kind: 'svg', svg: SVG_ICON } })
    const postIndex = harness.calls.findIndex((call) => call.method === 'POST' && call.path === '/api/workspaces')
    const putIndex = harness.calls.findIndex((call) => call.method === 'PUT' && call.path === '/api/workspaces/ws-1/icon')
    expect(postIndex).toBeGreaterThanOrEqual(0)
    expect(putIndex).toBeGreaterThan(postIndex)
    expect(harness.closeModal).toHaveBeenCalled()
  })

  it('图标没改动时保存工作区不再重传图标', async () => {
    const harness = createHarness({ initialIcon: { kind: 'svg', svg: SVG_ICON } })
    harness.manager.openWorkspaceEditor('ws-1')

    await harness.manager.saveWorkspaceEditor()

    expect(harness.iconWrites()).toHaveLength(0)
  })

  it('清空草稿图标后保存发送删除', async () => {
    const harness = createHarness({ initialIcon: { kind: 'svg', svg: SVG_ICON } })
    harness.manager.openWorkspaceEditor('ws-1')
    harness.manager.clearWorkspaceIcon()

    await harness.manager.saveWorkspaceEditor()

    expect(harness.iconWrites()).toEqual([{ method: 'DELETE', path: '/api/workspaces/ws-1/icon', body: undefined }])
    expect(harness.icon()).toBeNull()
  })

  it('图标写入失败：如实报错并保留编辑框，不谎报保存完成', async () => {
    const harness = createHarness({ failIconWrite: true })
    harness.manager.openWorkspaceEditor('ws-1')
    harness.manager.setWorkspaceIconSvg(SVG_ICON)

    await harness.manager.saveWorkspaceEditor()

    expect(harness.showToast).toHaveBeenCalledWith(
      expect.stringContaining('图标未保存'),
      expect.objectContaining({ kind: 'error' }),
    )
    expect(harness.closeModal).not.toHaveBeenCalled()
  })
})
