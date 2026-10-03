import * as React from 'react'
import type { DataDirStatus, HyperCortexGateway } from '../gateway'
import type { PageId } from './workspacePages'

// 外部命令队列的消费与分发：现场可见且初始化就绪时取队首命令，先出队再分发；
// 随命令消费一并刷新数据目录状态（设置页可见时）。
// 现场负责提供队列、消费回调与命令落地所需能力，模块负责分发规则与消费副作用。

export function useAppCommandDispatch(opts: {
  visible: boolean
  tabsInitReady: boolean
  activeWorkspaceId: string
  repoReady: boolean
  visiblePage: PageId
  appCommandQueue: string[]
  consumeAppCommand: () => void
  refreshDataDirStatus: () => Promise<DataDirStatus | void>
  gateway: HyperCortexGateway
  handleCreateDraftNote: () => void
  navigatePage: (next: PageId) => void
  setShortcutHintsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setQuickSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
}): void {
  const {
    visible,
    tabsInitReady,
    activeWorkspaceId,
    repoReady,
    visiblePage,
    appCommandQueue,
    consumeAppCommand,
    refreshDataDirStatus,
    gateway,
    handleCreateDraftNote,
    navigatePage,
    setShortcutHintsOpen,
    setQuickSearchOpen,
  } = opts

  const handleAppCommand = React.useCallback(
    (command: string | null | undefined) => {
      const id = String(command || '').trim()
      if (!id || id === 'open-hypercortex') return
      if (id === 'new-note') {
        handleCreateDraftNote()
        return
      }
      if (id === 'quick-search') {
        setShortcutHintsOpen(false)
        setQuickSearchOpen(true)
        return
      }
      if (id === 'open-assets') {
        navigatePage('attachments')
        return
      }
      void gateway.host.toast(`未知命令：${id}`)
    },
    [gateway, handleCreateDraftNote, navigatePage],
  )

  React.useEffect(() => {
    if (!visible) return
    if (!tabsInitReady || !activeWorkspaceId) return
    const command = String(appCommandQueue[0] || '').trim()
    if (!command) return
    consumeAppCommand()
    handleAppCommand(command)
  }, [activeWorkspaceId, appCommandQueue, consumeAppCommand, handleAppCommand, tabsInitReady, visible])

  React.useEffect(() => {
    if (!visible) return
    if (!repoReady) return
    if (visiblePage !== 'settings') return
    void refreshDataDirStatus().catch(() => {})
  }, [refreshDataDirStatus, repoReady, visible, visiblePage])
}
