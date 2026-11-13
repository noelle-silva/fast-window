// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { normalizeDesks } from '../../domain/desks'
import { addDeskDraft, resetDeskDrafts } from '../../domain/deskDrafts'
import { SESSION_REF_PENDING_TITLE } from '../../domain/sessionRefPlaceholder'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { SidebarBPanel } from './SidebarBPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}
const workspaceIcon = { kind: 'image', svg: '', dataUrl: 'data:image/png;base64,WSICON' }

function deskRef(overrides: Record<string, any> = {}) {
  return { targetKind: 'role', targetId: 'role-a', roleId: '', chatId: 'chat-1', addedAt: 1, ...overrides }
}

const wsRef = deskRef({ targetKind: 'workspace', targetId: 'ws-1', roleId: 'role-b', chatId: 'chat-2' })

// 面板自己从后端那份 desks 数据装配条目，测试给的是数据本身。
function deskData(refs: any[] = [deskRef(), wsRef]) {
  return {
    desks: normalizeDesks({ items: refs.map((chat) => ({ type: 'chat', chat })) }),
    roles: [
      { id: 'role-a', name: '甲角色' },
      { id: 'role-b', name: '乙角色', avatarImage: 'role-avatar-src' },
    ],
    workspaces: [{ id: 'ws-1', name: '工作区一', icon: workspaceIcon }],
    chatsByRole: { 'role-a': { chatMetas: [{ id: 'chat-1', title: '甲会话', contextTokens: 48000 }] } },
    chatsByWorkspace: { 'ws-1::role-b': { chatMetas: [{ id: 'chat-2', title: '乙会话' }] } },
  }
}

function deskGroupData(collapsed: boolean) {
  const data = deskData([deskRef()])
  return {
    ...data,
    desks: normalizeDesks({
      items: [
        {
          type: 'group',
          group: {
            id: 'g1',
            name: '分组一',
            chats: [deskRef()],
            collapsed,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ],
    }),
  }
}

function createController() {
  return {
    getSnapshot: () => 0,
    subscribe: () => () => {},
    getScopeVer: () => 0,
    subscribeScope: () => () => {},
    actions: {},
  } as any
}

const favoritesStub: React.ComponentProps<typeof SidebarBPanel>['favoritesBrowser'] = {
  level: { folders: [], refs: [] },
  canGoBack: false,
  onBack: noop,
  onCreateFolder: noop,
  onOpenRef: noop,
  onRefContextMenu: noop,
  onNavigate: noop,
  onReorderFolders: noop,
  onReorderRefs: noop,
  onMoveRef: noop,
  onRemoveRef: noop,
  onAddToDesk: noop,
  hoverShowsRoleIcon: true,
}

function createProps(overrides: Partial<React.ComponentProps<typeof SidebarBPanel>> = {}): React.ComponentProps<typeof SidebarBPanel> {
  return {
    side: 'right',
    width: 260,
    sidebarRef: null,
    resizing: false,
    onSplitterPointerDown: noop,
    topbarOpacity: 100,
    topbarBlur: 0,
    tab: 'desk',
    onTabChange: noop,
    tabsVariant: 'soft',
    favoritesBrowser: favoritesStub,
    controller: createController(),
    data: deskData(),
    activeChatId: '',
    runningChatIds: new Set<string>(),
    chatSessionRunNotices: {},
    waitingConfirmationKeys: new Set<string>(),
    hoverShowsRoleIcon: true,
    onOpenDeskEntry: noop,
    onRemoveDeskEntry: noop,
    onDismissDeskNotice: noop,
    onDeskEntryContextMenu: noop,
    ...overrides,
  }
}

describe('侧边栏 B 的工作桌面', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    resetDeskDrafts()
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

  function renderPanel(overrides: Partial<React.ComponentProps<typeof SidebarBPanel>> = {}) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(
        <ThemeProvider theme={theme}>
          <SidebarBPanel {...createProps(overrides)} />
        </ThemeProvider>,
      )
    })
  }

  function row(title: string): HTMLElement {
    const node = host!.querySelector(`[role="button"][aria-label="${title}"]`)
    if (!node) throw new Error(`找不到桌面条目：${title}`)
    return node as HTMLElement
  }

  it('按后端那份桌面数据的顺序列出会话', () => {
    renderPanel()

    expect(host!.textContent).toContain('甲会话')
    expect(host!.textContent).toContain('乙会话')
  })

  it('每一条都带自己的移除按钮', () => {
    renderPanel()

    expect(host!.querySelector('[aria-label="从工作桌面移除 甲会话"]')).toBeTruthy()
    expect(host!.querySelector('[aria-label="从工作桌面移除 乙会话"]')).toBeTruthy()
  })

  it('点行交给打开动作，点叉交给移除动作且不连带打开', () => {
    const opened: string[] = []
    const removed: string[] = []
    renderPanel({
      onOpenDeskEntry: (entry) => opened.push(entry.chatId),
      onRemoveDeskEntry: (entry) => removed.push(entry.chatId),
    })

    act(() => {
      row('甲会话').click()
    })
    expect(opened).toEqual(['chat-1'])

    act(() => {
      ;(host!.querySelector('[aria-label="从工作桌面移除 乙会话"]') as HTMLElement).click()
    })
    expect(removed).toEqual(['chat-2'])
    expect(opened).toEqual(['chat-1'])
  })

  it('每一条都能弹与会话列表同一个右键菜单', () => {
    const seen: string[] = []
    renderPanel({ onDeskEntryContextMenu: (_event, entry) => seen.push(entry.chatId) })

    act(() => {
      row('甲会话').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })

    expect(seen).toEqual(['chat-1'])
  })

  it('会话通知按同一把键换成行尾绿点，点它就标记已读', () => {
    const dismissed: string[] = []
    renderPanel({
      chatSessionRunNotices: { 'role:role-a:chat-1': { kind: 'completed', changedAt: 10 } },
      onDismissDeskNotice: (entry) => dismissed.push(entry.chatId),
    })

    const dot = row('甲会话').querySelector('[aria-label="会话已完成，点一下标记已读"]') as HTMLElement
    expect(dot).toBeTruthy()
    act(() => dot.click())
    expect(dismissed).toEqual(['chat-1'])
  })

  it('工作区条目用「工作区|角色」合成键认状态，等待确认压过已完成', () => {
    renderPanel({
      chatSessionRunNotices: { 'workspace:ws-1::role-b:chat-2': { kind: 'completed', changedAt: 10 } },
      waitingConfirmationKeys: new Set<string>(['workspace:ws-1::role-b:chat-2']),
    })

    expect(row('乙会话').querySelector('[aria-label="有工具请求等待确认，点一下去处理"]')).toBeTruthy()
    expect(row('甲会话').querySelector('[aria-label="会话已完成，点一下标记已读"]')).toBeNull()
  })

  it('正在看的会话不画点，提醒只给不在眼前的条目', () => {
    renderPanel({
      activeChatId: 'chat-1',
      chatSessionRunNotices: { 'role:role-a:chat-1': { kind: 'completed', changedAt: 10 } },
    })

    expect(row('甲会话').querySelector('[aria-label="会话已完成，点一下标记已读"]')).toBeNull()
  })

  it('每一行都挂着可拖排序的句柄声明', () => {
    renderPanel()

    expect(row('甲会话').getAttribute('aria-roledescription')).toBe('sortable')
    expect(row('乙会话').getAttribute('aria-roledescription')).toBe('sortable')
  })

  it('当前正在看的会话有选中状态，其它条目没有', () => {
    renderPanel({ activeChatId: 'chat-2' })

    expect(row('乙会话').getAttribute('aria-current')).toBe('true')
    expect(row('甲会话').getAttribute('aria-current')).toBeNull()
  })

  it('运行中的会话在名称下面多一行 running 标记，其余条目没有', () => {
    renderPanel({ runningChatIds: new Set(['chat-1']) })

    expect(row('甲会话').textContent).toContain('running...')
    expect(row('乙会话').textContent).not.toContain('running...')
  })

  it('运行标记落在第三行，和上下文用量并排，不占名称的横向位置', () => {
    renderPanel({ runningChatIds: new Set(['chat-1']) })

    const mark = Array.from(row('甲会话').querySelectorAll('*')).find((it) => it.textContent === 'running...')
    expect(mark).toBeTruthy()
    const usageRow = mark!.parentElement as HTMLElement
    expect(usageRow.textContent).toContain('48k')
    expect(usageRow.textContent).toContain('running...')
    expect(usageRow.textContent).not.toContain('甲会话')
    expect((usageRow.parentElement as HTMLElement).textContent).toContain('甲会话')
  })

  it('第三行显示会话已经用掉的上下文，没有真值的条目显示问号', () => {
    renderPanel()

    expect(row('甲会话').textContent).toContain('48k')
    expect(row('乙会话').textContent).toContain('?')
  })

  it('工作区条目悬停换成所属角色图标，开关关掉就一直是工作区图标', () => {
    renderPanel()
    expect(row('乙会话').querySelector('img')!.getAttribute('src')).toBe(workspaceIcon.dataUrl)

    act(() => {
      row('乙会话').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(row('乙会话').querySelector('img')!.getAttribute('src')).toBe('role-avatar-src')

    renderPanel({ hoverShowsRoleIcon: false })
    act(() => {
      row('乙会话').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(row('乙会话').querySelector('img')!.getAttribute('src')).toBe(workspaceIcon.dataUrl)
  })

  it('临时条目按更淡的样子出现，并带自己的移除按钮', () => {
    addDeskDraft({ pendingChatId: 'draft-1', targetKind: 'role', targetId: 'role-a', title: '待发送会话' })
    renderPanel()

    const draftRow = host!.querySelector('[data-desk-draft="1"]') as HTMLElement
    expect(draftRow).toBeTruthy()
    expect(draftRow.textContent).toContain('待发送会话')
    expect(host!.querySelector('[aria-label="从工作桌面移除 待发送会话"]')).toBeTruthy()
    // 真实条目仍在，两者并存
    expect(host!.textContent).toContain('甲会话')
  })

  it('临时条目不参与拖拽排序', () => {
    addDeskDraft({ pendingChatId: 'draft-1', targetKind: 'role', targetId: 'role-a', title: '待发送会话' })
    renderPanel()

    const draftRow = host!.querySelector('[data-desk-draft="1"]') as HTMLElement
    expect(draftRow.getAttribute('aria-roledescription')).toBeNull()
  })

  it('桌面为空时给出空态提示', () => {
    renderPanel({ data: deskData([]) })

    expect(host!.textContent).toContain('桌面上还没有会话')
  })

  it('工具行的收起全部把动作交给控制器', () => {
    const calls: string[] = []
    const controller = createController()
    controller.actions.collapseAllDeskGroups = () => calls.push('collapse')

    renderPanel({ controller, data: deskGroupData(false) })
    const button = host!.querySelector('button[aria-label="收起全部"]') as HTMLButtonElement
    expect(button.disabled).toBe(false)

    act(() => button.click())
    expect(calls).toEqual(['collapse'])
  })

  it('没有展开着的分组时收起全部置灰', () => {
    renderPanel({ data: deskGroupData(true) })

    expect((host!.querySelector('button[aria-label="收起全部"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('没加载过的组合先显示待加载，并按 target 批量预取一次索引', () => {
    const calls: any[][] = []
    const controller = createController()
    controller.actions.hydrateSessionIndexScopes = (scopes: any[]) => {
      calls.push(scopes)
      return Promise.resolve(true)
    }

    renderPanel({
      controller,
      data: deskData([
        deskRef({ targetKind: 'workspace', targetId: 'ws-9', roleId: 'role-z', chatId: 'chat-z' }),
        deskRef({ targetKind: 'workspace', targetId: 'ws-9', roleId: 'role-z', chatId: 'chat-z2' }),
      ]),
    })

    expect(host!.textContent).toContain(SESSION_REF_PENDING_TITLE)
    // 同一组合的两条引用只算一个 scope：一次请求把所有 target 拉齐。
    expect(calls).toEqual([[{ kind: 'workspace', targetId: 'ws-9::role-z' }]])
  })
})
