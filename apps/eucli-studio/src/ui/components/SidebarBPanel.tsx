import * as React from 'react'
import type { SidebarSide } from '../../domain/sidebarLayout'
import type { DeskEntry } from '../../domain/desk'
import type { DeskSidebarTab } from '../../domain/sidebarNavigationMemory'
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
  favoritesBrowser: FavoriteFoldersBrowserProps
  deskEntries: DeskEntry[]
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
    favoritesBrowser,
    deskEntries,
    activeChatId,
    runningChatIds,
    hoverShowsRoleIcon,
    onOpenDeskEntry,
    onRemoveDeskEntry,
    onMoveDeskEntry,
    onDeskEntryContextMenu,
  } = props

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
