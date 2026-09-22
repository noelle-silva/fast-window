import { describe, expect, it, vi } from 'vitest'
import { createViewerActions } from './viewerActions'

function setup(modal: string) {
  const state: any = {
    modal,
    mermaid: { items: [], index: 0, scale: 1 },
    imageViewer: { items: [], index: 0, scale: 1, returnModal: '' },
  }
  const emit = vi.fn()
  const closeModal = vi.fn()
  const actions = createViewerActions({
    state,
    emit,
    showToast: undefined,
    closeModal,
    activeChatFromData: () => null,
    sanitizeSvg: (svg: any) => String(svg ?? ''),
    currentRenderSafetyPolicy: () => 'original',
    locateMessageInActiveChat: () => null,
    aiFixMermaidInMessage: async () => ({}),
    reloadRoleSession: async () => ({}),
    reloadWorkspaceSession: async () => ({}),
  })
  return { state, emit, closeModal, actions }
}

describe('图片查看器的弹窗返回机制', () => {
  it('从角色弹窗打开时记住来源，关闭后回到原弹窗', () => {
    const { state, closeModal, actions } = setup('role')
    actions.openImageItems([{ src: 'data:image/svg+xml,%3Csvg%3E', alt: '依赖树' }])
    expect(state.modal).toBe('image')
    expect(state.imageViewer.returnModal).toBe('role')
    expect(state.imageViewer.items).toHaveLength(1)

    actions.closeImageViewer()
    expect(state.modal).toBe('role')
    expect(state.imageViewer.returnModal).toBe('')
    expect(closeModal).not.toHaveBeenCalled()
  })

  it('从聊天页打开时没有来源，关闭走原有 closeModal', () => {
    const { state, closeModal, actions } = setup('')
    actions.openImageItems([{ src: 'https://example.com/a.png' }])
    expect(state.imageViewer.returnModal).toBe('')
    actions.closeImageViewer()
    expect(closeModal).toHaveBeenCalledTimes(1)
  })

  it('过滤空图片地址且无有效图片时不打开', () => {
    const { state, emit, actions } = setup('role')
    const opened = actions.openImageItems([{ src: '   ' }, null, { src: 'data:image/png;base64,AAA' }])
    expect(opened).toBe(true)
    expect(state.imageViewer.items).toEqual([{ src: 'data:image/png;base64,AAA', alt: '图片' }])

    emit.mockClear()
    state.modal = 'role'
    expect(actions.openImageItems([])).toBe(false)
    expect(state.modal).toBe('role')
    expect(emit).not.toHaveBeenCalled()
  })

  it('索引越界时收敛到有效范围', () => {
    const { state, actions } = setup('')
    actions.openImageItems([{ src: 'a' }, { src: 'b' }], 9)
    expect(state.imageViewer.index).toBe(1)
  })
})
