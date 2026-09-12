import * as React from 'react'
import { collectionPathIds, type CollectionNodes } from './collectionsTree'

export type FolderNavigation = {
  currentFolderId: string
  pathIds: string[]
  canGoBack: boolean
  canGoForward: boolean
  navigateTo: (folderId: string) => void
  goBack: () => void
  goForward: () => void
}

// useFolderNavigation 维护「进入式浏览」的导航历史与当前收藏夹。
// 切换仓库自动重置到该仓库根；当前收藏夹被删除时回退到根。
export function useFolderNavigation(repoId: string, nodes: CollectionNodes): FolderNavigation {
  const [history, setHistory] = React.useState<{ stack: string[]; index: number }>(() =>
    ({ stack: repoId ? [repoId] : [], index: 0 }),
  )

  React.useEffect(() => {
    setHistory({ stack: repoId ? [repoId] : [], index: 0 })
  }, [repoId])

  const rawFolderId = history.stack[history.index] || repoId
  const currentFolderId = repoId && nodes[rawFolderId] ? rawFolderId : repoId

  React.useEffect(() => {
    if (repoId && rawFolderId !== currentFolderId) {
      setHistory({ stack: [repoId], index: 0 })
    }
  }, [repoId, rawFolderId, currentFolderId])

  const navigateTo = React.useCallback((folderId: string) => {
    setHistory(current => {
      if (!nodes[folderId]) return current
      if (folderId === current.stack[current.index]) return current
      const stack = [...current.stack.slice(0, current.index + 1), folderId]
      return { stack, index: stack.length - 1 }
    })
  }, [nodes])

  const goBack = React.useCallback(() => {
    setHistory(current => (current.index > 0 ? { ...current, index: current.index - 1 } : current))
  }, [])

  const goForward = React.useCallback(() => {
    setHistory(current => (current.index < current.stack.length - 1 ? { ...current, index: current.index + 1 } : current))
  }, [])

  const pathIds = React.useMemo(
    () => (repoId ? collectionPathIds(nodes, repoId, currentFolderId) : []),
    [nodes, repoId, currentFolderId],
  )

  return {
    currentFolderId,
    pathIds,
    canGoBack: history.index > 0,
    canGoForward: history.index < history.stack.length - 1,
    navigateTo,
    goBack,
    goForward,
  }
}
