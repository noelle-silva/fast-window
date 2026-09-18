import * as React from 'react'

export type LazyListWindowOptions = {
  resetKey: string
  total: number
  pageSize: number
  bottomThresholdRatio?: number
}

export function useLazyListWindow(options: LazyListWindowOptions) {
  const pageSize = Math.max(1, Math.floor(Number(options.pageSize || 1)))
  const total = Math.max(0, Math.floor(Number(options.total || 0)))
  const bottomThresholdRatio = Math.max(0, Math.min(1, Number(options.bottomThresholdRatio ?? 0.25)))
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const [visibleCount, setVisibleCount] = React.useState(() => Math.min(pageSize, total))

  React.useEffect(() => {
    setVisibleCount(Math.min(pageSize, total))
    const el = scrollRef.current
    if (el) el.scrollTop = 0
  }, [options.resetKey, pageSize])

  React.useEffect(() => {
    setVisibleCount((current) => Math.min(Math.max(pageSize, current), total))
  }, [pageSize, total])

  const loadNextPage = React.useCallback(() => {
    setVisibleCount((current) => Math.min(total, Math.max(pageSize, current) + pageSize))
  }, [pageSize, total])

  const onScrollPositionChange = React.useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    if (maxScrollTop <= 0) return
    const remaining = maxScrollTop - el.scrollTop
    if (remaining <= el.clientHeight * bottomThresholdRatio) loadNextPage()
  }, [bottomThresholdRatio, loadNextPage])

  React.useEffect(() => {
    onScrollPositionChange(scrollRef.current)
  }, [onScrollPositionChange, visibleCount])

  return {
    scrollRef,
    onScrollPositionChange,
    visibleCount,
    hasMore: visibleCount < total,
  }
}
