import * as React from 'react'
import type { SidebarDisplayMode, TabsMode } from '../appSettingsModel'
import { visiblePageId } from '../pageDisplay'
import {
  isEditableTarget,
  mainKeyFromChord,
  normalizeMainKey,
  shouldTriggerShortcut,
  type HyperCortexShortcutBindingsV1,
  type HyperCortexShortcutId,
} from '../shortcuts'
import { noteIdFromTabKey, tabKind, type TabKey } from '../tabKey'
import type { FavoriteFolderView } from './favoritesSidebarModel'
import type { NoteDetailSessionHandle } from './NoteDetailSession'
import type { SidebarItem } from './sidebarModel'
import type { SidebarPreviewTarget } from './sidebar-preview/previewTarget'
import { readHoveredSidebarPreviewTarget } from './sidebar-preview/useSidebarPreviewHover'
import type { PageId } from './workspacePages'

// 全局快捷键监听与分发：现场可见时挂载主键盘监听，统一处理按键抬起判定、长按重复、
// 按住预览、侧栏长按展开与切页/新建/搜索/关闭标签等分发。
// 现场负责提供快捷键绑定、提示开关、录制互斥标记与各动作端口，模块负责监听与分发规则。

function isKeyUpForChordMainKey(e: KeyboardEvent, chord: string): boolean {
  const main = mainKeyFromChord(chord)
  if (!main) return false
  return normalizeMainKey(e.key) === main
}

// 页面切换类快捷键的目标页映射：触发即走统一分流（独立页=切页，模态窗=弹层/替换/关层）。
const PAGE_SHORTCUT_TARGETS: { id: HyperCortexShortcutId; target: PageId }[] = [
  { id: 'goHomePage', target: 'home' },
  { id: 'goFavoritesPage', target: 'index' },
  { id: 'goAttachmentsPage', target: 'attachments' },
  { id: 'goAllNotesPage', target: 'all-notes' },
  { id: 'goSettingsPage', target: 'settings' },
]

export function useGlobalShortcuts(opts: {
  visible: boolean
  shortcutBindingsRef: React.MutableRefObject<HyperCortexShortcutBindingsV1>
  shortcutRecordingRef: React.MutableRefObject<boolean>
  shortcutHintsOpen: boolean
  setShortcutHintsOpen: React.Dispatch<React.SetStateAction<boolean>>
  pageRef: React.MutableRefObject<PageId>
  openModalPageRef: React.MutableRefObject<PageId | null>
  activeNoteIdRef: React.MutableRefObject<string>
  activeTabKeyRef: React.MutableRefObject<TabKey>
  openTabKeysRef: React.MutableRefObject<TabKey[]>
  sidebarItemsRef: React.MutableRefObject<SidebarItem[]>
  favoritesFolderViewRef: React.MutableRefObject<FavoriteFolderView>
  resolvedSelectionSourceRef: React.MutableRefObject<'tabs' | 'favorites'>
  activateFavoritesEntryKeyRef: React.MutableRefObject<(tabKey: string) => boolean>
  activateExistingTabKeyRef: React.MutableRefObject<(tabKey: string, opts?: { recordHistory?: boolean }) => boolean>
  setFavoritesActiveScrollSignal: React.Dispatch<React.SetStateAction<number>>
  setActiveTabScrollSignal: React.Dispatch<React.SetStateAction<number>>
  previewHoldRef: React.MutableRefObject<boolean>
  cancelPreviewClear: () => void
  applyPreviewTarget: (target: SidebarPreviewTarget | null) => void
  stopPreview: () => void
  tabsMode: TabsMode
  setTabsHoverOpen: React.Dispatch<React.SetStateAction<boolean>>
  sidebarShortcutHoldRef: React.MutableRefObject<boolean>
  sidebarHoverRef: React.MutableRefObject<boolean>
  toggleTabsCollapsed: () => void
  favoritesSidebarMode: SidebarDisplayMode
  setFavoritesHoverOpen: React.Dispatch<React.SetStateAction<boolean>>
  favoritesSidebarShortcutHoldRef: React.MutableRefObject<boolean>
  favoritesHoverRef: React.MutableRefObject<boolean>
  toggleFavoritesSidebarCollapsed: () => void
  goBackPage: () => Promise<void>
  handleShortcutOpenPage: (targetId: PageId) => void
  handleCreateDraftNote: () => void
  setQuickSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  requestCloseTabRef: React.MutableRefObject<(noteId: string) => void>
  closeTabKeysDirectRef: React.MutableRefObject<(tabKeys: string[]) => void>
  noteSessionHandlesRef: React.MutableRefObject<Record<string, NoteDetailSessionHandle | null>>
}): void {
  const {
    visible,
    shortcutBindingsRef,
    shortcutRecordingRef,
    shortcutHintsOpen,
    setShortcutHintsOpen,
    pageRef,
    openModalPageRef,
    activeNoteIdRef,
    activeTabKeyRef,
    openTabKeysRef,
    sidebarItemsRef,
    favoritesFolderViewRef,
    resolvedSelectionSourceRef,
    activateFavoritesEntryKeyRef,
    activateExistingTabKeyRef,
    setFavoritesActiveScrollSignal,
    setActiveTabScrollSignal,
    previewHoldRef,
    cancelPreviewClear,
    applyPreviewTarget,
    stopPreview,
    tabsMode,
    setTabsHoverOpen,
    sidebarShortcutHoldRef,
    sidebarHoverRef,
    toggleTabsCollapsed,
    favoritesSidebarMode,
    setFavoritesHoverOpen,
    favoritesSidebarShortcutHoldRef,
    favoritesHoverRef,
    toggleFavoritesSidebarCollapsed,
    goBackPage,
    handleShortcutOpenPage,
    handleCreateDraftNote,
    setQuickSearchOpen,
    requestCloseTabRef,
    closeTabKeysDirectRef,
    noteSessionHandlesRef,
  } = opts

  React.useEffect(() => {
    // 快捷键只属于活动现场：非活动现场的监听不挂载，避免多现场同时响应。
    if (!visible) return

    const clearTabSwitchHold = () => {
      const win = window as any
      if (win.__hcTabSwitchHoldTimer) clearTimeout(win.__hcTabSwitchHoldTimer)
      if (win.__hcTabSwitchHoldInterval) clearInterval(win.__hcTabSwitchHoldInterval)
      win.__hcTabSwitchHoldTimer = null
      win.__hcTabSwitchHoldInterval = null
      win.__hcTabSwitchHoldDir = null
    }

    const getVisibleSidebarTabKeys = (): string[] => {
      const openKeys = new Set((openTabKeysRef.current || []).map(s => String(s || '').trim()).filter(Boolean))
      const out: string[] = []
      const seen = new Set<string>()

      const pushTabKey = (rawTabKey: unknown) => {
        const tabKey = String(rawTabKey || '').trim()
        if (!tabKey || !openKeys.has(tabKey) || seen.has(tabKey)) return
        seen.add(tabKey)
        out.push(tabKey)
      }

      // 快捷键切换必须跟侧边栏渲染使用同一份线性模型，否则根标签会被误排到所有分组前面。
      for (const item of sidebarItemsRef.current || []) {
        if (item.type === 'tab') {
          pushTabKey(item.tabKey)
          continue
        }
        if (item.collapsed === true) continue
        for (const tabKey of item.tabKeys) pushTabKey(tabKey)
      }

      return out
    }

    // 右侧收藏夹栏当前页的可切换条目序列：与渲染同源（同一份视图），按引用顺序解析。
    const getVisibleFavoriteTabKeys = (): string[] => favoritesFolderViewRef.current.entries.map(entry => entry.tabKey)

    const getVisibleSwitchKeys = (): string[] =>
      resolvedSelectionSourceRef.current === 'favorites' ? getVisibleFavoriteTabKeys() : getVisibleSidebarTabKeys()

    const triggerSwitchTab = (direction: -1 | 1): boolean => {
      if (pageRef.current !== 'note-detail' && pageRef.current !== 'asset-detail') {
        clearTabSwitchHold()
        return false
      }
      const fromFavorites = resolvedSelectionSourceRef.current === 'favorites'
      const keys = getVisibleSwitchKeys()
      if (keys.length <= 1) {
        clearTabSwitchHold()
        return false
      }
      const cur = String(activeTabKeyRef.current || '').trim()
      const idx = cur ? keys.indexOf(cur) : -1
      if (idx < 0) {
        // 归属右侧时当前目标必在右侧列表内；能到这里说明左侧详情页没有 active tab，属异常，直接停止。
        clearTabSwitchHold()
        return false
      }
      const nextIndex = idx + direction
      if (nextIndex < 0 || nextIndex >= keys.length) {
        // 到边界就停，不循环。
        clearTabSwitchHold()
        return false
      }
      const nextKey = String(keys[nextIndex] || '').trim()
      if (!nextKey || nextKey === cur) return false
      const activated = fromFavorites
        ? activateFavoritesEntryKeyRef.current(nextKey)
        : activateExistingTabKeyRef.current(nextKey, { recordHistory: false })
      if (activated) {
        if (fromFavorites) setFavoritesActiveScrollSignal(signal => signal + 1)
        else setActiveTabScrollSignal(signal => signal + 1)
      }
      return activated
    }

    const startTabSwitchHoldToRepeat = (direction: -1 | 1) => {
      // 按住重复：首发一次，然后 260ms 后进入 55ms 连发。
      const win = window as any
      clearTabSwitchHold()
      win.__hcTabSwitchHoldDir = direction

      const didSwitch = triggerSwitchTab(direction)
      if (!didSwitch) return

      // 不满足“在标签页内且有至少 2 个标签页”时，不启动连发。
      if (pageRef.current !== 'note-detail' && pageRef.current !== 'asset-detail') return
      if (getVisibleSwitchKeys().length <= 1) return

      win.__hcTabSwitchHoldTimer = setTimeout(() => {
        win.__hcTabSwitchHoldInterval = setInterval(() => {
          triggerSwitchTab(win.__hcTabSwitchHoldDir === -1 ? -1 : 1)
        }, 55)
      }, 260)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (shortcutRecordingRef.current) return

      if (e.key === 'Escape' && shortcutHintsOpen) {
        e.preventDefault()
        e.stopPropagation()
        setShortcutHintsOpen(false)
        return
      }

      const bindings = shortcutBindingsRef.current
      if (!bindings) return

      // 禁用 Tab 的默认“焦点切换/选中游走”，但不影响编辑器/输入框内的 Tab（例如缩进）。
      // 若 Tab 已被绑定为某个快捷键（如按住预览），则放行给下方快捷键分发处理。
      if (e.key === 'Tab' && !isEditableTarget(e.target)) {
        const tabBoundToShortcut = Object.entries(bindings).some(([key, chord]) => key !== 'version' && shouldTriggerShortcut(e, String(chord || '')))
        if (!tabBoundToShortcut) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }

      // 注意力焦点：浮层开着时，快捷键应作用于浮层页面；被遮住的底层页面不再响应。
      const overlayPage = openModalPageRef.current
      const focusPage = visiblePageId(pageRef.current, overlayPage)

      // 按住预览：按住即进入预览态并立刻拾取当前悬停条目；松开时还原。
      if (shouldTriggerShortcut(e, bindings.holdPreview)) {
        e.preventDefault()
        e.stopPropagation()
        previewHoldRef.current = true
        cancelPreviewClear()
        applyPreviewTarget(readHoveredSidebarPreviewTarget())
        return
      }

      // 长按行为只在对应 mainKey 抬起时停止。
      if (!overlayPage && shouldTriggerShortcut(e, bindings.selectPrevTab)) {
        e.preventDefault()
        e.stopPropagation()
        startTabSwitchHoldToRepeat(-1)
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.selectNextTab)) {
        e.preventDefault()
        e.stopPropagation()
        startTabSwitchHoldToRepeat(1)
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.toggleSidebar)) {
        e.preventDefault()
        e.stopPropagation()
        if (tabsMode === 'hover') {
          sidebarShortcutHoldRef.current = true
          setTabsHoverOpen(true)
        } else {
          toggleTabsCollapsed()
        }
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.toggleFavoritesSidebar)) {
        e.preventDefault()
        e.stopPropagation()
        if (favoritesSidebarMode === 'hover') {
          favoritesSidebarShortcutHoldRef.current = true
          setFavoritesHoverOpen(true)
        } else {
          toggleFavoritesSidebarCollapsed()
        }
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.goBackPage)) {
        e.preventDefault()
        e.stopPropagation()
        void goBackPage()
        return
      }

      for (const item of PAGE_SHORTCUT_TARGETS) {
        if (shouldTriggerShortcut(e, bindings[item.id])) {
          e.preventDefault()
          e.stopPropagation()
          handleShortcutOpenPage(item.target)
          return
        }
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.newNote)) {
        e.preventDefault()
        e.stopPropagation()
        handleCreateDraftNote()
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.toggleQuickSearch)) {
        e.preventDefault()
        e.stopPropagation()
        setShortcutHintsOpen(false)
        setQuickSearchOpen(prev => !prev)
        return
      }

      if (!overlayPage && shouldTriggerShortcut(e, bindings.closeActiveTab)) {
        if (focusPage !== 'note-detail' && focusPage !== 'asset-detail') return
        const key = String(activeTabKeyRef.current || '').trim()
        if (!key) return
        e.preventDefault()
        e.stopPropagation()
        if (tabKind(key) === 'note') {
          const nid = noteIdFromTabKey(key)
          if (!nid) return
          requestCloseTabRef.current(nid)
        } else {
          closeTabKeysDirectRef.current([key])
        }
        return
      }

      if (focusPage !== 'note-detail') return
      const nid = String(activeNoteIdRef.current || '').trim()
      if (!nid) return
      const handle = noteSessionHandlesRef.current[nid]
      if (!handle) return

      if (shouldTriggerShortcut(e, bindings.saveNote)) {
        e.preventDefault()
        e.stopPropagation()
        void handle.save()
        return
      }

      if (shouldTriggerShortcut(e, bindings.toggleMode)) {
        e.preventDefault()
        e.stopPropagation()
        handle.toggleMode()
        return
      }

      if (shouldTriggerShortcut(e, bindings.cycleFace)) {
        e.preventDefault()
        e.stopPropagation()
        handle.cycleFace()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (shortcutRecordingRef.current) return

      // stop hold-to-repeat tab switching
      const bindings = shortcutBindingsRef.current
      if (bindings) {
        const win = window as any
        const holding = !!(win && (win.__hcTabSwitchHoldTimer || win.__hcTabSwitchHoldInterval))
        if (holding) {
          const upPrev = bindings.selectPrevTab && isKeyUpForChordMainKey(e, bindings.selectPrevTab)
          const upNext = bindings.selectNextTab && isKeyUpForChordMainKey(e, bindings.selectNextTab)
          if (upPrev || upNext) clearTabSwitchHold()
        }
      }

      // 按住预览：松开快捷键（或窗口失焦）立即无缝还原原主区域内容。
      if (bindings && bindings.holdPreview && isKeyUpForChordMainKey(e, bindings.holdPreview)) {
        stopPreview()
      }

      // 收藏夹侧边栏按住展开：松开时若鼠标不在其上则收起。
      if (favoritesSidebarShortcutHoldRef.current && bindings && bindings.toggleFavoritesSidebar && isKeyUpForChordMainKey(e, bindings.toggleFavoritesSidebar)) {
        favoritesSidebarShortcutHoldRef.current = false
        if (!favoritesHoverRef.current) setFavoritesHoverOpen(false)
      }

      if (tabsMode !== 'hover') return
      if (!sidebarShortcutHoldRef.current) return
      if (!bindings) return
      if (!bindings.toggleSidebar) return
      if (!isKeyUpForChordMainKey(e, bindings.toggleSidebar)) return

      sidebarShortcutHoldRef.current = false
      if (!sidebarHoverRef.current) setTabsHoverOpen(false)
    }

    const onWindowBlur = () => {
      clearTabSwitchHold()
      stopPreview()
      favoritesSidebarShortcutHoldRef.current = false
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onWindowBlur, true)
    return () => {
      clearTabSwitchHold()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onWindowBlur, true)
    }
  }, [favoritesSidebarMode, goBackPage, handleCreateDraftNote, handleShortcutOpenPage, shortcutHintsOpen, stopPreview, tabsMode, toggleFavoritesSidebarCollapsed, toggleTabsCollapsed, visible])
}
