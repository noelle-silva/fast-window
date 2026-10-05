import * as React from 'react'
import type { NoteMeta } from '../core'
import type { AssetEntry } from '../assetTypes'
import type { PageId } from './workspacePages'
import { RepoWorkspaceToolbar } from './RepoWorkspaceToolbar'
import type { RepoWorkspaceOrchestration } from './useRepoWorkspaceOrchestration'

// 工具栏接线：把编排派生的状态与回调收拢为工具栏的导航、快速搜索与快捷键提示三段入参，
// 物理渲染仍交给 RepoWorkspaceToolbar（经槽位 portal 到外壳顶部栏）。

export function RepoWorkspaceToolbarHost(props: { orchestration: RepoWorkspaceOrchestration }) {
  const o = props.orchestration

  const toolbarNavigation = React.useMemo(() => ({
    backCount: o.navStackSizes.back,
    forwardCount: o.navStackSizes.forward,
    modalOpen: !!o.openModalPage,
    page: o.page,
    onBack: () => void o.goBackPage(),
    onForward: () => void o.goForwardPage(),
    onGoTo: (target: PageId) => o.navigatePage(target),
  }), [o.goBackPage, o.goForwardPage, o.navigatePage, o.navStackSizes.back, o.navStackSizes.forward, o.openModalPage, o.page])

  const toolbarQuickSearch = React.useMemo(() => ({
    gateway: o.gateway,
    scope: 'library' as const,
    open: o.quickSearchOpen,
    allNotesLayout: o.allNotesLayout,
    favoritesDoc: o.favoritesDoc,
    onToggle: () => o.setQuickSearchOpen(v => !v),
    onToggleAllNotesLayout: o.toggleAllNotesLayout,
    onClose: () => o.setQuickSearchOpen(false),
    onOpenNote: (note: NoteMeta, faceId?: string) => {
      o.setQuickSearchOpen(false)
      o.handleOpenNote(note, faceId)
    },
    onOpenAsset: (asset: AssetEntry) => {
      o.setQuickSearchOpen(false)
      o.handleOpenAssetTab(asset)
    },
  }), [o.allNotesLayout, o.favoritesDoc, o.gateway, o.handleOpenAssetTab, o.handleOpenNote, o.quickSearchOpen, o.toggleAllNotesLayout])

  const toolbarShortcutHints = React.useMemo(() => ({
    enabled: o.shortcutHintsEnabled,
    open: o.shortcutHintsOpen,
    bindings: o.shortcutBindings,
    onToggle: () => {
      o.setQuickSearchOpen(false)
      o.setShortcutHintsOpen(prev => !prev)
    },
    onClose: () => o.setShortcutHintsOpen(false),
  }), [o.shortcutBindings, o.shortcutHintsEnabled, o.shortcutHintsOpen])

  return (
    <RepoWorkspaceToolbar
      slots={o.shell.toolbarSlots}
      navigation={toolbarNavigation}
      quickSearch={toolbarQuickSearch}
      shortcutHints={toolbarShortcutHints}
    />
  )
}
