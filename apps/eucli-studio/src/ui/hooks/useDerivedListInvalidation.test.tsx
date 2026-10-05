// @vitest-environment happy-dom
//
// 派生列表失效依据单一来源守护：
// 列表的条数 / 排序 / 过滤 / 可见项只允许以刷新中枢递增的全局数据版本号为重算依据。
// 时序场景：先进入目标（列表为空），数据后到（就地写入 + 中枢 emit），列表必须自动出现，
// 不得停留在旧结果，也不得依赖切换目标或对象引用比对来补救。
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material'
import { getColorThemeColors, resolveColorThemePreview } from '../../domain/colorTheme'
import { workspaceRoleTargetId } from '../../domain/workspaceRoleTarget'
import { createStudioMuiTheme } from '../colorThemeStyles'
import { ChatPickerPopover } from '../dialogs/ChatPickerPopover'
import { createUiCore } from '../uiCore'
import { useChatSessionPickers } from './useChatSessionPickers'
import { useFavoriteFolders } from './useFavoriteFolders'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

type TargetKind = 'role' | 'group' | 'workspace'

const noop: any = () => {}
const emptyIndicator: any = () => ''

function createControllerStub(uiCore: ReturnType<typeof createUiCore>) {
  return {
    getSnapshot: () => uiCore.getVer(),
    subscribe: uiCore.subscribe,
    getScopeVer: (scope: string) => uiCore.getScopeVer(scope),
    subscribeScope: (scope: string, fn: () => void) => uiCore.subscribeScope(scope, fn),
    fmtTime: () => '',
    actions: {},
  } as any
}

function createData() {
  return {
    chatsByRole: {},
    chatsByGroup: {},
    chatsByWorkspace: {},
    favorites: { folders: [] as any[], chatRefsByFolderId: {} as Record<string, any[]> },
  } as any
}

function targetIdOf(kind: TargetKind, role: any, group: any, workspace: any) {
  if (kind === 'group') return String(group?.id || '')
  if (kind === 'workspace') return workspaceRoleTargetId(workspace?.id, role?.id)
  return String(role?.id || '')
}

function boxOf(data: any, kind: TargetKind, targetId: string) {
  const boxes = kind === 'group' ? data.chatsByGroup : kind === 'workspace' ? data.chatsByWorkspace : data.chatsByRole
  return boxes[targetId]
}

function ChatPickerHarness(props: {
  controller: any
  data: any
  kind: TargetKind
  role: any
  group: any
  workspace: any
  anchor: HTMLElement
  startView: 'history' | 'favorites'
}) {
  const { controller, data, kind, role, group, workspace, anchor, startView } = props
  const [view, setView] = React.useState<'history' | 'favorites'>(startView)
  const targetId = targetIdOf(kind, role, group, workspace)

  const pickers = useChatSessionPickers({
    controller,
    data,
    loading: false,
    page: 'chat',
    setPage: noop,
    setSettingsTab: noop,
    activeTargetKind: kind,
    activeGroup: group,
    activeWorkspace: workspace,
    activeRole: role,
    activeChatTargetId: targetId,
    setFavoriteChatMenu: noop,
    closeFavoriteChatMenu: noop,
    closeFavoriteFolderMenu: noop,
    closeFavoriteDialog: noop,
    closeCreateFavoriteFolder: noop,
    closeRenameFavoriteFolder: noop,
    closeDeleteFavoriteFolderConfirm: noop,
    closeMoveFavoriteFolderContents: noop,
    closeMoveFavoriteFolderDialog: noop,
    closeConfirmClearFavoriteFolder: noop,
    setFavoriteSearchOpen: noop,
    setFavoriteSearchText: noop,
  })

  const favorites = useFavoriteFolders({
    controller,
    data,
    roles: [role],
    groups: [group],
    workspaces: [workspace],
    clearChatSessionRunNotice: noop,
    requestSwitch: noop,
    closeChatPicker: noop,
    chatSessionRunIndicatorKind: emptyIndicator,
    activeTargetKind: kind,
    activeChatTargetId: targetId,
    activeChatId: '',
  })

  return (
    <ChatPickerPopover
      controller={controller}
      data={data}
      chatPickerEl={anchor}
      closeChatPicker={noop}
      chatPickerView={view}
      setChatPickerView={setView}
      chatPickerSearchOpen={pickers.chatPickerSearchOpen}
      setChatPickerSearchOpen={pickers.setChatPickerSearchOpen}
      chatPickerSearchText={pickers.chatPickerSearchText}
      setChatPickerSearchText={pickers.setChatPickerSearchText}
      chatPickerSearchInputRef={pickers.chatPickerSearchInputRef}
      chatHistoryScrollRef={pickers.chatHistoryScrollRef}
      onChatHistoryScrollPositionChange={pickers.onChatHistoryScrollPositionChange}
      chatHistoryVisibleCount={pickers.chatHistoryVisibleCount}
      favoriteSearchOpen={favorites.favoriteSearchOpen}
      setFavoriteSearchOpen={favorites.setFavoriteSearchOpen}
      favoriteSearchText={favorites.favoriteSearchText}
      setFavoriteSearchText={favorites.setFavoriteSearchText}
      favoriteSearchInputRef={favorites.favoriteSearchInputRef}
      favoriteFolders={favorites.favoriteFolders}
      renderFavoriteFolderTree={favorites.renderFavoriteFolderTree}
      collapseAllFavoriteFolders={favorites.collapseAllFavoriteFolders}
      openCreateFavoriteFolder={favorites.openCreateFavoriteFolder}
      activeTargetKind={kind}
      activeGroup={group}
      activeWorkspace={workspace}
      activeRole={role}
      activeChatTargetId={targetId}
      pendingGroupChat={null}
      pendingWorkspaceChat={null}
      pendingRoleChat={null}
      chatSessionRunIndicatorKind={emptyIndicator}
      clearChatSessionRunNotice={noop}
      requestSwitch={noop}
      onChatContextMenu={noop}
    />
  )
}

const TARGET_LABEL: Record<TargetKind, string> = { role: '角色', group: '群组', workspace: '工作区' }

describe('派生列表失效依据：刷新中枢全局数据版本号', () => {
  let host: HTMLDivElement | null = null
  let anchor: HTMLButtonElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    anchor = document.createElement('button')
    document.body.appendChild(host)
    document.body.appendChild(anchor)
    root = createRoot(host)
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
    anchor?.remove()
    anchor = null
  })

  function renderHarness(element: React.ReactElement) {
    const theme = createStudioMuiTheme('light', getColorThemeColors(resolveColorThemePreview(undefined, null)))
    act(() => {
      root.render(<ThemeProvider theme={theme}>{element}</ThemeProvider>)
    })
  }

  for (const kind of ['role', 'group', 'workspace'] as const) {
    it(`先进入${TARGET_LABEL[kind]}目标、会话数据后到时，${TARGET_LABEL[kind]}会话列表自动出现且无需切换目标`, () => {
      const uiCore = createUiCore()
      const controller = createControllerStub(uiCore)
      const data = createData()
      const role = { id: 'r1', name: '角色一' }
      const group = { id: 'g1', name: '群组一' }
      const workspace = { id: 'w1', name: '工作区一' }
      const targetId = targetIdOf(kind, role, group, workspace)
      const boxes = kind === 'group' ? data.chatsByGroup : kind === 'workspace' ? data.chatsByWorkspace : data.chatsByRole
      boxes[targetId] = { activeChatId: '', chatMetas: [], chats: [] }

      renderHarness(
        <ChatPickerHarness controller={controller} data={data} kind={kind} role={role} group={group} workspace={workspace} anchor={anchor!} startView="history" />,
      )
      expect(document.body.textContent).toContain('没有匹配的会话')

      act(() => {
        boxOf(data, kind, targetId).chatMetas.push({ id: 'c1', title: '后到会话', updatedAt: 100 })
        uiCore.emit()
      })

      expect(document.body.textContent).toContain('后到会话')
    })
  }

  it('先打开收藏夹、收藏数据后到时，收藏夹列表自动出现且无需切换视图', () => {
    const uiCore = createUiCore()
    const controller = createControllerStub(uiCore)
    const data = createData()
    const role = { id: 'r1', name: '角色一' }
    const group = { id: 'g1', name: '群组一' }
    const workspace = { id: 'w1', name: '工作区一' }
    const targetId = targetIdOf('workspace', role, group, workspace)
    data.chatsByWorkspace[targetId] = { activeChatId: '', chatMetas: [], chats: [] }

    renderHarness(
      <ChatPickerHarness controller={controller} data={data} kind="workspace" role={role} group={group} workspace={workspace} anchor={anchor!} startView="favorites" />,
    )
    expect(document.body.textContent).toContain('还没有收藏夹')

    act(() => {
      data.favorites.folders.push({ id: 'f1', name: '后到收藏夹', parentId: '', createdAt: 1 })
      uiCore.emit()
    })

    expect(document.body.textContent).toContain('后到收藏夹')
  })
})
