import * as React from 'react'
import type { SidebarSide } from '../../domain/sidebarLayout'
import { deskFlatRefs, resolveDeskEntries, type DeskEntry } from '../../domain/desks'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { workspaceRoleTargetId } from '../../domain/workspaceRoleTarget'
import { useScopedUiVersion, useScopedUiVersions } from '../hooks/useScopedUiVersion'
import type { DeskSidebarTab } from '../../domain/sidebarNavigationMemory'
import type { SidebarTabsVariant } from '../../domain/sidebarTabs'
import { SidebarFrame } from './SidebarFrame'
import { SidebarTabsHeader, type SidebarTabItem } from './SidebarTabsHeader'
import { FavoriteFoldersBrowser, type FavoriteFoldersBrowserProps } from './favorites/FavoriteFoldersBrowser'
import { DeskChatList } from './sidebar-b/DeskChatList'

// 侧边栏 B：工作桌面 / 会话收藏夹。两段都是会话的去处——
// 桌面只管把眼下要用的会话摆在手边，收藏夹按文件夹层级浏览。
// 外壳与 A 共用 SidebarFrame，顶部切换栏与 A 共用 SidebarTabsHeader。
// 返回上一层属于收藏夹分类自己的工具行，落在 FavoriteFoldersBrowser 里，不占侧边栏级顶部栏。
const DESK_TABS: readonly SidebarTabItem<DeskSidebarTab>[] = [
  { value: 'desk', label: '工作桌面' },
  { value: 'favorites', label: '会话收藏夹' },
]

export type SidebarBPanelProps = {
  side: SidebarSide
  width: number
  sidebarRef: React.Ref<HTMLElement>
  resizing: boolean
  onSplitterPointerDown: (e: React.PointerEvent) => void
  topbarOpacity: number
  topbarBlur: number
  tab: DeskSidebarTab
  onTabChange: (tab: DeskSidebarTab) => void
  tabsVariant: SidebarTabsVariant
  favoritesBrowser: FavoriteFoldersBrowserProps
  controller: any
  data: any
  activeChatId: string
  runningChatIds: ReadonlySet<string>
  hoverShowsRoleIcon: boolean
  onOpenDeskEntry: (entry: DeskEntry) => void
  onRemoveDeskEntry: (entry: DeskEntry) => void
  onMoveDeskEntry: (activeKey: string, overKey: string) => void
  onDeskEntryContextMenu: (event: React.MouseEvent, entry: DeskEntry) => void
}

export function SidebarBPanel(props: SidebarBPanelProps) {
  const {
    side,
    width,
    sidebarRef,
    resizing,
    onSplitterPointerDown,
    topbarOpacity,
    topbarBlur,
    tab,
    onTabChange,
    tabsVariant,
    favoritesBrowser,
    controller,
    data,
    activeChatId,
    runningChatIds,
    hoverShowsRoleIcon,
    onOpenDeskEntry,
    onRemoveDeskEntry,
    onMoveDeskEntry,
    onDeskEntryContextMenu,
  } = props

  // 面板自己订阅桌面数据域：后端 sessions/desks 变更（增删、清理）就让清单重算；
  // 再按每条引用所在会话列表订阅，改名与会话增删也能跟上。
  const desksVersion = useScopedUiVersion(controller, refreshScopes.entities('desks'))
  const desks = (data as any)?.desks
  const flatRefs = React.useMemo(() => deskFlatRefs(desks), [desks, desksVersion])
  const chatListScopes = React.useMemo(
    () =>
      flatRefs.map((ref: any) =>
        refreshScopes.chatList(
          ref.targetKind,
          ref.targetKind === 'workspace' ? workspaceRoleTargetId(ref.targetId, ref.roleId) : ref.targetId,
        ),
      ),
    [flatRefs],
  )
  const chatListVersion = useScopedUiVersions(controller, chatListScopes)
  const deskEntries = React.useMemo(
    () => resolveDeskEntries(data, desks),
    [data, desks, desksVersion, chatListVersion],
  )

  return (
    <SidebarFrame
      sidebarId="b"
      ariaLabel="侧边栏 B"
      side={side}
      width={width}
      sidebarRef={sidebarRef}
      resizing={resizing}
      onSplitterPointerDown={onSplitterPointerDown}
      topbarOpacity={topbarOpacity}
      topbarBlur={topbarBlur}
      header={
        <SidebarTabsHeader
          ariaLabel="侧边栏 B 页签"
          tabs={DESK_TABS}
          value={tab}
          onChange={onTabChange}
          variant={tabsVariant}
        />
      }
    >
      {tab === 'desk' ? (
        <DeskChatList
          entries={deskEntries}
          activeChatId={activeChatId}
          runningChatIds={runningChatIds}
          hoverShowsRoleIcon={hoverShowsRoleIcon}
          onOpen={onOpenDeskEntry}
          onRemove={onRemoveDeskEntry}
          onMove={onMoveDeskEntry}
          onContextMenu={onDeskEntryContextMenu}
        />
      ) : (
        <FavoriteFoldersBrowser {...favoritesBrowser} />
      )}
    </SidebarFrame>
  )
}
