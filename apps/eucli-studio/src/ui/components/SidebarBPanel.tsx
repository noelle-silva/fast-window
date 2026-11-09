import * as React from 'react'
import type { SidebarSide } from '../../domain/sidebarLayout'
import type { DeskEntry } from '../../domain/desk'
import { SidebarFrame } from './SidebarFrame'
import { DeskChatList } from './sidebar-b/DeskChatList'

// 侧边栏 B：工作桌面。与会话收藏夹并列的另一套会话去处——
// 收藏夹负责归档分类，桌面只管把眼下要用的会话摆在手边。
// 外壳与 A 共用 SidebarFrame（位置、宽度、拖拽把手），内容只是会话条目清单。
export type SidebarBPanelProps = {
  side: SidebarSide
  width: number
  sidebarRef: React.Ref<HTMLElement>
  resizing: boolean
  onSplitterPointerDown: (e: React.PointerEvent) => void
  topbarOpacity: number
  topbarBlur: number
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
