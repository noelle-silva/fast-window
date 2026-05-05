import * as React from 'react'

type UseLazyListLimitArgs = {
  enabled: boolean
  total: number
  limit: number
  setLimit: React.Dispatch<React.SetStateAction<number>>
  rootRef: React.RefObject<HTMLDivElement | null>
  sentinelRef: React.RefObject<HTMLDivElement | null>

  step?: number
  rootMargin?: string
  nearBottomOffsetPx?: number
  cooldownMs?: number
  pollIntervalMs?: number
  attachRetryMs?: number
}

/**
 * Lazy-increase a list limit using IntersectionObserver, with scroll/poll fallback.
 *
 * Designed for WebView environments where IntersectionObserver may be flaky.
 */
export function useLazyListLimit(args: UseLazyListLimitArgs) {
  const {
    enabled,
    total,
    limit,
    setLimit,
    rootRef,
    sentinelRef,
    step = 36,
    rootMargin = '240px 0px',
    nearBottomOffsetPx = 320,
    cooldownMs = 120,
    pollIntervalMs = 200,
    attachRetryMs = 50,
  } = args

  const cooldownRef = React.useRef(0)
  const totalRef = React.useRef(total)
  const limitRef = React.useRef(limit)
  const stepRef = React.useRef(step)
  const nearBottomOffsetPxRef = React.useRef(nearBottomOffsetPx)
  const cooldownMsRef = React.useRef(cooldownMs)

  React.useEffect(() => {
    totalRef.current = total
    limitRef.current = limit
    stepRef.current = step
    nearBottomOffsetPxRef.current = nearBottomOffsetPx
    cooldownMsRef.current = cooldownMs
  }, [total, limit, step, nearBottomOffsetPx, cooldownMs])

  // IntersectionObserver path (one-shot per limit increment).
  React.useEffect(() => {
    if (!enabled) return
    if (typeof IntersectionObserver === 'undefined') return

    const totalNow = Math.max(0, total)
    const limitNow = Math.max(0, limit)
    if (limitNow >= totalNow) return

    const sentinel = sentinelRef.current
    if (!sentinel) return

    const root = rootRef.current
    let done = false

    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries && entries[0] && entries[0].isIntersecting
        if (!hit) return
        if (done) return
        done = true
        try {
          observer.disconnect()
        } catch {}
        setLimit((n) => Math.min(Math.max(0, n) + step, totalNow))
      },
      { root: root || null, rootMargin, threshold: 0 },
    )

    try {
      observer.observe(sentinel)
    } catch {}

    return () => {
      done = true
      try {
        observer.disconnect()
      } catch {}
    }
  }, [enabled, total, limit, step, rootMargin, rootRef, sentinelRef, setLimit])

  // Scroll/poll fallback path.
  React.useEffect(() => {
    if (!enabled) return

    let disposed = false
    let timer: any = null
    let poller: any = null
    let el: HTMLDivElement | null = null

    const maybeLoadMore = () => {
      if (!el) return

      const totalNow = Math.max(0, totalRef.current)
      const limitNow = Math.max(0, limitRef.current)
      if (limitNow >= totalNow) return

      // Some WebViews may not trigger IntersectionObserver reliably.
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - Math.max(0, nearBottomOffsetPxRef.current)
      if (!nearBottom) return

      const now = Date.now()
      const cd = Math.max(0, cooldownMsRef.current)
      if (now - cooldownRef.current < cd) return
      cooldownRef.current = now
      const stepNow = Math.max(1, Math.floor(stepRef.current || 1))
      setLimit((n) => Math.min(Math.max(0, n) + stepNow, totalNow))
    }

    const attach = () => {
      if (disposed) return
      const next = rootRef.current
      if (!next) {
        timer = setTimeout(attach, attachRetryMs)
        return
      }

      el = next

      const onScroll = () => {
        try {
          maybeLoadMore()
        } catch {}
      }

      el.addEventListener('scroll', onScroll, { passive: true })

      // Some environments may have unreliable scroll events.
      poller = setInterval(() => {
        try {
          maybeLoadMore()
        } catch {}
      }, pollIntervalMs)

      // If the first page doesn't create a scrollbar, keep filling.
      try {
        maybeLoadMore()
      } catch {}

      return () => {
        el?.removeEventListener('scroll', onScroll)
        if (poller) {
          try {
            clearInterval(poller)
          } catch {}
          poller = null
        }
      }
    }

    let detach: null | (() => void) = null
    detach = attach() || null

    return () => {
      disposed = true
      if (timer) {
        try {
          clearTimeout(timer)
        } catch {}
      }
      if (poller) {
        try {
          clearInterval(poller)
        } catch {}
      }
      if (detach) {
        try {
          detach()
        } catch {}
      }
    }
  }, [enabled, rootRef, setLimit, pollIntervalMs, attachRetryMs])
}
