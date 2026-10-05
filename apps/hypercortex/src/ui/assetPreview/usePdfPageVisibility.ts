import * as React from 'react'

const PAGE_OBSERVER_ROOT_MARGIN = '900px 0px'

export function usePageVisibility(rootRef: React.RefObject<HTMLDivElement>, pageNumber: number, scale: number, forceVisible = false): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = React.useState(forceVisible || pageNumber === 1)

  React.useEffect(() => {
    if (forceVisible) {
      setVisible(true)
      return
    }
    const el = ref.current
    if (!el) return
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry?.isIntersecting) setVisible(true)
      },
      { root, rootMargin: PAGE_OBSERVER_ROOT_MARGIN, threshold: 0.01 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [forceVisible, pageNumber, rootRef, scale])

  return [ref, visible]
}
