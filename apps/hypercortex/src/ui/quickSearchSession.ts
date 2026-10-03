import * as React from 'react'

/**
 * 统一搜索会话骨架：笔记与附件共用同一套「触发重搜 / 分页续读 / 命中总数 / 错误」机制，
 * 仅由调用方替换数据源（fetchPage）与触发条件（signature）。
 * 分页与命中总数以后端返回为准：hasMore 由已加载条数与 total 推导。
 */

export type SearchPage<T> = {
  items: T[]
  total: number
}

export type SearchSession<T> = {
  items: T[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
}

export type UseSearchSessionOptions<T> = {
  // 是否启用搜索；关闭时清空结果。
  enabled: boolean
  // 触发条件签名：任一变化即整体重搜（条件随请求整体提交）。
  signature: string
  // 每次请求条数：首次加载与下滑续读共用。
  pageSize: number
  // 取一页数据；offset 为在排序结果中的起始位置。
  fetchPage: (offset: number, limit: number) => Promise<SearchPage<T>>
}

// 输入节流：键盘输入与过滤项切换统一走同一防抖，避免连点连敲打爆后端。
const SEARCH_DEBOUNCE_MS = 200

export function useSearchSession<T>(options: UseSearchSessionOptions<T>): SearchSession<T> {
  const { enabled, signature, pageSize, fetchPage } = options

  const [items, setItems] = React.useState<T[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const seqRef = React.useRef(0)
  const fetchRef = React.useRef(fetchPage)
  const itemsRef = React.useRef<T[]>([])
  fetchRef.current = fetchPage
  itemsRef.current = items

  React.useEffect(() => {
    if (!enabled) {
      // 关闭时推进序号：使任何在途请求的结果失效，避免清空后又被回填。
      seqRef.current++
      setItems([])
      setTotal(0)
      setError(null)
      setLoading(false)
      setLoadingMore(false)
      return
    }
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    const timer = window.setTimeout(() => {
      fetchRef
        .current(0, pageSize)
        .then(page => {
          if (seqRef.current !== seq) return
          setItems(page.items)
          setTotal(page.total)
        })
        .catch((e: any) => {
          if (seqRef.current !== seq) return
          setError(String(e?.message || e || '搜索失败'))
          setItems([])
          setTotal(0)
        })
        .finally(() => {
          if (seqRef.current === seq) setLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [enabled, pageSize, signature])

  const loadMore = React.useCallback(() => {
    if (!enabled || loading || loadingMore) return
    if (itemsRef.current.length >= total) return
    setLoadingMore(true)
    const seq = seqRef.current
    fetchRef
      .current(itemsRef.current.length, pageSize)
      .then(page => {
        if (seqRef.current !== seq) return
        setItems(prev => (prev.length ? [...prev, ...page.items] : page.items))
        setTotal(page.total)
      })
      .catch((e: any) => {
        if (seqRef.current !== seq) return
        setError(String(e?.message || e || '搜索失败'))
      })
      .finally(() => {
        if (seqRef.current === seq) setLoadingMore(false)
      })
  }, [enabled, loading, loadingMore, pageSize, total])

  return {
    items,
    total,
    loading,
    loadingMore,
    error,
    hasMore: items.length < total,
    loadMore,
  }
}
