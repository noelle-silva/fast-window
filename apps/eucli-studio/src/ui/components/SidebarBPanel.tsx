import * as React from 'react'
import type { SidebarSide } from '../../domain/sidebarLayout'
import { SidebarFrame } from './SidebarFrame'
import { WorkspaceBList } from './sidebar-b/WorkspaceBList'

// 侧边栏 B：客户端内的第二块侧边栏。
// 外壳与 A 完全复用（位置、宽度、拖拽把手都由 SidebarFrame 承担），
// 内容是工作区列表：整套行样式与拖拽排序照搬 apps/hypercortex 的工作区侧边栏。
export type SidebarBPanelProps = {
  side: SidebarSide
  width: number
  sidebarRef: React.Ref<HTMLElement>
  resizing: boolean
  onSplitterPointerDown: (e: React.PointerEvent) => void
  topbarOpacity: number
  topbarBlur: number
  workspaces: any[]
  activeWorkspaceId: string
  activeTargetKind: 'role' | 'group' | 'workspace'
  openPluginSettings: (tab: any) => void
  onSelectWorkspace: (workspaceId: string) => void
  onOpenWorkspaceEditor: (workspaceId: string) => void
  onMoveWorkspace: (activeId: string, overId: string) => void
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
    workspaces,
    activeWorkspaceId,
    activeTargetKind,
    openPluginSettings,
    onSelectWorkspace,
    onOpenWorkspaceEditor,
    onMoveWorkspace,
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
      <WorkspaceBList
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeTargetKind={activeTargetKind}
        openPluginSettings={openPluginSettings}
        onSelectWorkspace={onSelectWorkspace}
        onOpenWorkspaceEditor={onOpenWorkspaceEditor}
        onMoveWorkspace={onMoveWorkspace}
      />
    </SidebarFrame>
  )
}
