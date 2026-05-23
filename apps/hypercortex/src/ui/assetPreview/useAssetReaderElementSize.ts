import * as React from 'react'

export type AssetReaderElementSize = {
  width: number
  height: number
}

export function useAssetReaderElementSize<T extends HTMLElement>() {
  const elementRef = React.useRef<T | null>(null)
  const [element, setElement] = React.useState<T | null>(null)
  const [size, setSize] = React.useState<AssetReaderElementSize>({ width: 0, height: 0 })

  const ref = React.useCallback((nextElement: T | null) => {
    elementRef.current = nextElement
    setElement(nextElement)
  }, [])

  React.useEffect(() => {
    if (!element) return

    const applySize = () => {
      const rect = element.getBoundingClientRect()
      setSize({ width: Math.max(0, rect.width), height: Math.max(0, rect.height) })
    }

    applySize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', applySize)
      return () => window.removeEventListener('resize', applySize)
    }

    const observer = new ResizeObserver(() => applySize())
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return { ref, elementRef, size }
}
