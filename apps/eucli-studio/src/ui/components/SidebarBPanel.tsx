import * as React from 'react'
import type { SidebarSide } from '../../domain/sidebarLayout'
import type { DeskEntry } from '../../domain/desk'
import type { DeskSidebarTab } from '../../domain/sidebarNavigationMemory'
import { SidebarFrame } from './SidebarFrame'
import { SidebarTabsHeader, type SidebarTabItem } from './SidebarTabsHeader'
import { DeskChatList } from './sidebar-b/DeskChatList'

// 侧边栏 B：工作桌面。与会话收藏夹并列的另一套会话去处——
// 收藏夹负责归档分类，桌面只管把眼下要用的会话摆在手边。
// 外壳与 A 共用 SidebarFrame（位置、宽度、拖拽把手），顶部切换栏与 A 共用 SidebarTabsHeader。
// 页签眼下只有「工作桌面」一段；加分类时在 DESK_TABS 里追加取值，内容再按当前段分派。
const DESK_TABS: readonly SidebarTabItem<DeskSidebarTab>[] = [{ value: 'desk', label: '工作桌面' }]

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
  deskEntries: DeskEntry[]
  activeChatId: string
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
    deskEntries,
    activeChatId,
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
      <DeskChatList
        entries={deskEntries}
        activeChatId={activeChatId}
        hoverShowsRoleIcon={hoverShowsRoleIcon}
        onOpen={onOpenDeskEntry}
        onRemove={onRemoveDeskEntry}
        onMove={onMoveDeskEntry}
        onContextMenu={onDeskEntryContextMenu}
      />
    </SidebarFrame>
  )
}
