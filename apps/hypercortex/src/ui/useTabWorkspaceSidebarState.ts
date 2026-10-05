import * as React from 'react'
import type { HyperCortexTabGroupV1, HyperCortexWorkspaceV1 } from '../core'
import type { TabsMode } from '../appSettingsModel'
import type { TabKey } from '../tabKey'
import type { SidebarItem } from './sidebarModel'
import { resolveSidebarLayout } from './sidebarLayout'
import type { SidebarPreviewTarget } from './sidebar-preview/previewTarget'

// 标签页集合、工作区与侧边栏分组的状态段：打开的标签键与当前激活标签、工作区集合与激活工作区、
// 侧边栏条目与标签分组、左侧栏悬停与布局状态。
// 状态段供导航、附件会话、收藏夹与装载消费；与动作段之间只经显式入参连接，不引入隐式全局。

export function useTabWorkspaceSidebarState(opts: {
  tabsMode: TabsMode
  tabsCollapsed: boolean
  tabsSidebarWidth: number
  handleSidebarPreviewHover: (target: SidebarPreviewTarget | null) => void
}): {
  openTabKeys: TabKey[]
  setOpenTabKeys: React.Dispatch<React.SetStateAction<TabKey[]>>
  openTabKeysRef: React.MutableRefObject<TabKey[]>
  activeTabKey: TabKey
  setActiveTabKey: React.Dispatch<React.SetStateAction<TabKey>>
  activeTabKeyRef: React.MutableRefObject<TabKey>
  workspaces: HyperCortexWorkspaceV1[]
  setWorkspaces: React.Dispatch<React.SetStateAction<HyperCortexWorkspaceV1[]>>
  activeWorkspaceId: string
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string>>
  sidebarItems: SidebarItem[]
  setSidebarItems: React.Dispatch<React.SetStateAction<SidebarItem[]>>
  sidebarItemsRef: React.MutableRefObject<SidebarItem[]>
  tabGrouping: { groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }
  setTabGrouping: React.Dispatch<React.SetStateAction<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>>
  tabGroupingRef: React.MutableRefObject<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>
  setTabsHoverOpen: React.Dispatch<React.SetStateAction<boolean>>
  sidebarHoverRef: React.MutableRefObject<boolean>
  sidebarShortcutHoldRef: React.MutableRefObject<boolean>
  leftSidebarLayout: ReturnType<typeof resolveSidebarLayout>
  sidebarPanelWidth: number
  onSidebarMouseEnter: () => void
  onSidebarMouseLeave: () => void
} {
  const { tabsMode, tabsCollapsed, tabsSidebarWidth, handleSidebarPreviewHover } = opts

  const [openTabKeys, setOpenTabKeys] = React.useState<TabKey[]>([])
  const openTabKeysRef = React.useRef<TabKey[]>([])
  React.useEffect(() => {
    openTabKeysRef.current = openTabKeys
  }, [openTabKeys])

  const [activeTabKey, setActiveTabKey] = React.useState<TabKey>('')
  const activeTabKeyRef = React.useRef<TabKey>('')
  React.useEffect(() => {
    activeTabKeyRef.current = activeTabKey
  }, [activeTabKey])

  const [workspaces, setWorkspaces] = React.useState<HyperCortexWorkspaceV1[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string>('')

  const [sidebarItems, setSidebarItems] = React.useState<SidebarItem[]>([])
  const sidebarItemsRef = React.useRef<SidebarItem[]>([])
  React.useEffect(() => {
    sidebarItemsRef.current = sidebarItems
  }, [sidebarItems])
  const [tabGrouping, setTabGrouping] = React.useState<{ groups: HyperCortexTabGroupV1[]; byTabKey: Record<string, string> }>({
    groups: [],
    byTabKey: {},
  })
  const tabGroupingRef = React.useRef(tabGrouping)
  React.useEffect(() => {
    tabGroupingRef.current = tabGrouping
  }, [tabGrouping])

  const [tabsHoverOpen, setTabsHoverOpen] = React.useState(false)
  const sidebarHoverRef = React.useRef(false)
  const sidebarShortcutHoldRef = React.useRef(false)

  const isHoverTabsMode = tabsMode === 'hover'
  const leftSidebarLayout = resolveSidebarLayout({
    mode: tabsMode,
    collapsed: tabsCollapsed,
    hoverOpen: tabsHoverOpen,
    expandedWidth: tabsSidebarWidth,
  })
  const sidebarPanelWidth = leftSidebarLayout.panelWidth

  const onSidebarMouseEnter = React.useCallback(() => {
    sidebarHoverRef.current = true
    if (isHoverTabsMode) setTabsHoverOpen(true)
  }, [isHoverTabsMode])

  const onSidebarMouseLeave = React.useCallback(() => {
    sidebarHoverRef.current = false
    handleSidebarPreviewHover(null)
    if (!isHoverTabsMode) return
    if (sidebarShortcutHoldRef.current) return
    setTabsHoverOpen(false)
  }, [handleSidebarPreviewHover, isHoverTabsMode])

  return {
    openTabKeys,
    setOpenTabKeys,
    openTabKeysRef,
    activeTabKey,
    setActiveTabKey,
    activeTabKeyRef,
    workspaces,
    setWorkspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    sidebarItems,
    setSidebarItems,
    sidebarItemsRef,
    tabGrouping,
    setTabGrouping,
    tabGroupingRef,
    setTabsHoverOpen,
    sidebarHoverRef,
    sidebarShortcutHoldRef,
    leftSidebarLayout,
    sidebarPanelWidth,
    onSidebarMouseEnter,
    onSidebarMouseLeave,
  }
}
