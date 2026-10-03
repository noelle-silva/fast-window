import * as React from 'react'
import type { HyperCortexGateway } from '../gateway'
import { isModalCapablePageId, visiblePageId, type PageDisplayMode, type PageDisplayModesV1 } from '../pageDisplay'
import { noteIdFromTabKey, tabKind, type TabKey } from '../tabKey'
import type { PageId } from './workspacePages'

// 页面切页与前进后退历史：当前页与浮层页的唯一事实源，维护来处/未来两条历史栈，
// 提供切页、导航记录写入与校验应用、前进后退、浮层开合与回收站页入口。
// 现场负责提供详情标签键、打开标签集合与工作区补丁的读写端口，模块负责页面位置状态与历史行为。

// 全局页面历史中的一个精确位置：普通页面只需要 page；详情页必须同时保留当时的 tabKey。
type NavHistoryEntry = {
  page: PageId
  tabKey?: string
}

export function usePageNavigation(opts: {
  gateway: HyperCortexGateway
  pageDisplayModesRef: React.MutableRefObject<PageDisplayModesV1>
  activeTabKeyRef: React.MutableRefObject<TabKey>
  openTabKeysRef: React.MutableRefObject<TabKey[]>
  setDetailSelectionSource: React.Dispatch<React.SetStateAction<'tabs' | 'favorites'>>
  setActiveTabKey: React.Dispatch<React.SetStateAction<TabKey>>
  setActiveNoteId: React.Dispatch<React.SetStateAction<string>>
  commitActiveWorkspacePatchRef: React.MutableRefObject<(patch: { activeTabKey: string }) => void>
}): {
  page: PageId
  pageRef: React.MutableRefObject<PageId>
  visiblePage: PageId
  openModalPage: PageId | null
  openModalPageRef: React.MutableRefObject<PageId | null>
  setOpenModalPage: React.Dispatch<React.SetStateAction<PageId | null>>
  navStackSizes: { back: number; forward: number }
  navHistoryRef: React.MutableRefObject<NavHistoryEntry[]>
  fwdNavHistoryRef: React.MutableRefObject<NavHistoryEntry[]>
  syncNavStackCounts: () => void
  navigatePage: (next: PageId, opts?: { recordHistory?: boolean }) => void
  recordNewNavLocation: (entry: NavHistoryEntry) => void
  goBackPage: () => Promise<void>
  goForwardPage: () => Promise<void>
  handleShortcutOpenPage: (targetId: PageId) => void
  closeModalOverlay: () => void
  handleOpenTrashPage: () => void
  handleOpenRepoTrashPage: () => void
} {
  const {
    gateway,
    pageDisplayModesRef,
    activeTabKeyRef,
    openTabKeysRef,
    setDetailSelectionSource,
    setActiveTabKey,
    setActiveNoteId,
    commitActiveWorkspacePatchRef,
  } = opts

  const [page, setPageState] = React.useState<PageId>('home')
  const pageRef = React.useRef<PageId>('home')
  React.useEffect(() => {
    pageRef.current = page
  }, [page])

  const navHistoryRef = React.useRef<NavHistoryEntry[]>([])
  const fwdNavHistoryRef = React.useRef<NavHistoryEntry[]>([])

  const [openModalPage, setOpenModalPage] = React.useState<PageId | null>(null)
  const visiblePage = visiblePageId(page, openModalPage)
  const openModalPageRef = React.useRef<PageId | null>(null)
  React.useEffect(() => {
    openModalPageRef.current = openModalPage
  }, [openModalPage])

  const resolvePageDisplayMode = React.useCallback((id: PageId): PageDisplayMode => {
    if (!isModalCapablePageId(id)) return 'page'
    return pageDisplayModesRef.current[id] ?? 'page'
  }, [])

  const [navStackSizes, setNavStackSizes] = React.useState({ back: 0, forward: 0 })

  const syncNavStackCounts = React.useCallback(() => {
    setNavStackSizes({ back: navHistoryRef.current.length, forward: fwdNavHistoryRef.current.length })
  }, [])

  // 所有新导航（切页/开标签）的唯一入口：截断“未来”，记录“来处”。
  const recordNewNavLocation = React.useCallback(
    (entry: NavHistoryEntry) => {
      fwdNavHistoryRef.current = []
      const stack = navHistoryRef.current
      const last = stack.length ? stack[stack.length - 1] : null
      const duplicate = !!last && last.page === entry.page && last.tabKey === entry.tabKey
      if (!duplicate) {
        stack.push(entry)
        if (stack.length > 128) stack.splice(0, stack.length - 128)
      }
      syncNavStackCounts()
    },
    [syncNavStackCounts],
  )

  const navigatePage = React.useCallback(
    (next: PageId, opts?: { recordHistory?: boolean }) => {
      // 模态窗页面的“到达”是浮层：不进页面家族，前进/后退与亮灯天然与它无关。
      if (resolvePageDisplayMode(next) === 'modal') {
        setOpenModalPage(next)
        return
      }
      if (next !== pageRef.current && opts?.recordHistory !== false) {
        const currentPage = pageRef.current
        const currentTabKey =
          currentPage === 'note-detail' || currentPage === 'asset-detail' ? String(activeTabKeyRef.current || '').trim() : ''
        recordNewNavLocation(currentTabKey ? { page: currentPage, tabKey: currentTabKey } : { page: currentPage })
      }
      setPageState(next)
    },
    [recordNewNavLocation, resolvePageDisplayMode],
  )

  // 快捷键打开页面的统一动作：模态窗=同名关层/异名替换，独立页=切页（先收浮层）。
  const handleShortcutOpenPage = React.useCallback(
    (targetId: PageId) => {
      if (resolvePageDisplayMode(targetId) === 'modal') {
        setOpenModalPage(prevOpen => (prevOpen === targetId ? null : targetId))
        return
      }
      setOpenModalPage(null)
      navigatePage(targetId)
    },
    [navigatePage, resolvePageDisplayMode],
  )

  // 把当前位置转换成一条可回溯的导航记录。
  const captureCurrentNavEntry = React.useCallback((): NavHistoryEntry => {
    const page = pageRef.current
    const cur = String(activeTabKeyRef.current || '').trim()
    if ((page === 'note-detail' || page === 'asset-detail') && cur) return { page, tabKey: cur }
    return { page }
  }, [])

  // 校验并应用一条导航记录；失败返回 false 且不产生任何状态副作用。
  const tryApplyNavEntry = React.useCallback(
    (entry: NavHistoryEntry): boolean => {
      if (entry.tabKey) {
        const key = String(entry.tabKey || '').trim()
        if (!key || !openTabKeysRef.current.includes(key)) return false
        const currentKey = String(activeTabKeyRef.current || '').trim()
        if (key === currentKey && entry.page === pageRef.current) return false
        const kind = tabKind(key)
        if (kind !== 'note' && kind !== 'asset') return false
        const targetPage = kind === 'note' ? 'note-detail' : 'asset-detail'
        if (entry.page !== targetPage) return false
        setDetailSelectionSource('tabs')
        setActiveTabKey(key as any)
        commitActiveWorkspacePatchRef.current({ activeTabKey: key })
        if (kind === 'note') {
          const noteId = noteIdFromTabKey(key)
          if (!noteId) return false
          setActiveNoteId(noteId)
          navigatePage(targetPage, { recordHistory: false })
        } else {
          setActiveNoteId('')
          navigatePage(targetPage, { recordHistory: false })
        }
        return true
      }

      const target = entry.page
      if (!target || target === pageRef.current) return false
      if (target === 'note-detail' || target === 'asset-detail') {
        // 详情页没有精确标签就不能安全恢复，禁止从当前打开集合中猜一条笔记。
        return false
      }

      navigatePage(target, { recordHistory: false })
      return true
    },
    [commitActiveWorkspacePatchRef, navigatePage],
  )

  const goBackPage = React.useCallback(async () => {
    const capture = captureCurrentNavEntry()
    while (navHistoryRef.current.length) {
      const entry = navHistoryRef.current.pop()!
      if (!tryApplyNavEntry(entry)) continue
      fwdNavHistoryRef.current.push(capture)
      if (fwdNavHistoryRef.current.length > 128) fwdNavHistoryRef.current.splice(0, fwdNavHistoryRef.current.length - 128)
      syncNavStackCounts()
      return
    }
    await gateway.host.toast('没有上一页了')
  }, [captureCurrentNavEntry, tryApplyNavEntry, syncNavStackCounts, gateway])

  const goForwardPage = React.useCallback(async () => {
    const capture = captureCurrentNavEntry()
    while (fwdNavHistoryRef.current.length) {
      const entry = fwdNavHistoryRef.current.pop()!
      if (!tryApplyNavEntry(entry)) continue
      navHistoryRef.current.push(capture)
      if (navHistoryRef.current.length > 128) navHistoryRef.current.splice(0, navHistoryRef.current.length - 128)
      syncNavStackCounts()
      return
    }
    await gateway.host.toast('没有下一页了')
  }, [captureCurrentNavEntry, tryApplyNavEntry, syncNavStackCounts, gateway])

  const closeModalOverlay = React.useCallback(() => setOpenModalPage(null), [])

  const handleOpenTrashPage = React.useCallback(() => navigatePage('trash'), [navigatePage])
  const handleOpenRepoTrashPage = React.useCallback(() => navigatePage('repo-trash'), [navigatePage])

  return {
    page,
    pageRef,
    visiblePage,
    openModalPage,
    openModalPageRef,
    setOpenModalPage,
    navStackSizes,
    navHistoryRef,
    fwdNavHistoryRef,
    syncNavStackCounts,
    navigatePage,
    recordNewNavLocation,
    goBackPage,
    goForwardPage,
    handleShortcutOpenPage,
    closeModalOverlay,
    handleOpenTrashPage,
    handleOpenRepoTrashPage,
  }
}
