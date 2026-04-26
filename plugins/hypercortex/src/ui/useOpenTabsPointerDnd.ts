import * as React from 'react'

type DropIndicator =
  | { kind: 'none' }
  | { kind: 'top-slot'; index: number }
  | { kind: 'group-slot'; groupId: string; index: number }

type DraggingState =
  | { kind: 'none' }
  | { kind: 'tab'; tabKey: string }
  | { kind: 'group'; groupId: string }

export type OpenTabsPointerDndOptions = {
  enabled?: boolean
  onMoveTabToUngroupedIndex: (tabKey: string, index: number) => void
  onMoveTabToGroupIndex: (tabKey: string, groupId: string, index: number) => void
  onMoveGroupToIndex: (groupId: string, index: number) => void
}

function isNoDragTarget(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null
  if (!el) return false
  if (el.closest('[data-hc-no-drag="1"]')) return true
  if (el.closest('button, a, input, textarea, select, option')) return true
  return false
}

function getHalfPos(clientY: number, el: HTMLElement): 'before' | 'after' {
  const rect = el.getBoundingClientRect()
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function parseNumberAttr(el: HTMLElement, name: string): number {
  const value = Number(el.getAttribute(name) || '')
  return Number.isFinite(value) ? value : -1
}

function pickDropIndicatorFromPoint(clientX: number, clientY: number, dragging: DraggingState): DropIndicator {
  const hit = document.elementFromPoint(clientX, clientY)
  if (!(hit instanceof Element)) return { kind: 'none' }

  const topSlotEl = hit.closest('[data-hc-dnd-top-slot-index]') as HTMLElement | null
  if (topSlotEl) {
    const index = parseNumberAttr(topSlotEl, 'data-hc-dnd-top-slot-index')
    return index >= 0 ? { kind: 'top-slot', index } : { kind: 'none' }
  }

  if (dragging.kind === 'tab') {
    const groupSlotEl = hit.closest('[data-hc-dnd-group-slot-index][data-hc-dnd-group-slot-id]') as HTMLElement | null
    if (groupSlotEl) {
      const groupId = String(groupSlotEl.getAttribute('data-hc-dnd-group-slot-id') || '').trim()
      const index = parseNumberAttr(groupSlotEl, 'data-hc-dnd-group-slot-index')
      return groupId && index >= 0 ? { kind: 'group-slot', groupId, index } : { kind: 'none' }
    }

    const groupHeaderEl = hit.closest('[data-hc-dnd-group-id]') as HTMLElement | null
    if (groupHeaderEl) {
      const groupId = String(groupHeaderEl.getAttribute('data-hc-dnd-group-id') || '').trim()
      return groupId ? { kind: 'group-slot', groupId, index: 0 } : { kind: 'none' }
    }

    const tabEl = hit.closest('[data-hc-dnd-tab-key]') as HTMLElement | null
    if (tabEl) {
      const groupId = String(tabEl.getAttribute('data-hc-dnd-parent-group-id') || '').trim()
      const groupTabIndex = parseNumberAttr(tabEl, 'data-hc-dnd-group-tab-index')
      if (groupId && groupTabIndex >= 0) {
        return { kind: 'group-slot', groupId, index: groupTabIndex + (getHalfPos(clientY, tabEl) === 'after' ? 1 : 0) }
      }

      const topIndex = parseNumberAttr(tabEl, 'data-hc-dnd-top-index')
      if (topIndex >= 0) {
        return { kind: 'top-slot', index: topIndex + (getHalfPos(clientY, tabEl) === 'after' ? 1 : 0) }
      }
    }
  }

  if (dragging.kind === 'group') {
    const groupSectionEl = hit.closest('[data-hc-dnd-group-section-index]') as HTMLElement | null
    if (groupSectionEl) {
      const topIndex = parseNumberAttr(groupSectionEl, 'data-hc-dnd-group-section-index')
      return topIndex >= 0 ? { kind: 'top-slot', index: topIndex + (getHalfPos(clientY, groupSectionEl) === 'after' ? 1 : 0) } : { kind: 'none' }
    }

    const tabEl = hit.closest('[data-hc-dnd-tab-key]') as HTMLElement | null
    if (tabEl) {
      const topIndex = parseNumberAttr(tabEl, 'data-hc-dnd-top-index')
      return topIndex >= 0 ? { kind: 'top-slot', index: topIndex + (getHalfPos(clientY, tabEl) === 'after' ? 1 : 0) } : { kind: 'none' }
    }
  }

  return { kind: 'none' }
}

export function useOpenTabsPointerDnd(opts: OpenTabsPointerDndOptions) {
  const { enabled = true, onMoveTabToUngroupedIndex, onMoveTabToGroupIndex, onMoveGroupToIndex } = opts

  const [dragOverKey, setDragOverKey] = React.useState('')
  const [draggingKey, setDraggingKey] = React.useState('')
  const [dropIndicator, setDropIndicator] = React.useState<DropIndicator>({ kind: 'none' })
  const suppressClickRef = React.useRef(false)
  const cleanupRef = React.useRef<(() => void) | null>(null)

  const cleanup = React.useCallback(() => {
    const fn = cleanupRef.current
    cleanupRef.current = null
    try {
      fn?.()
    } catch {
    }
  }, [])

  React.useEffect(() => cleanup, [cleanup])

  const begin = React.useCallback(
    (dragging: DraggingState, e: React.PointerEvent) => {
      if (!enabled) return
      if (e.button !== 0) return
      if (dragging.kind === 'none') return
      if (isNoDragTarget(e.target)) return
      cleanup()

      const pointerId = e.pointerId
      const startX = e.clientX
      const startY = e.clientY
      let started = false
      let prevUserSelect = ''

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        if (!started) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return
          started = true
          suppressClickRef.current = true
          setDraggingKey(dragging.kind === 'tab' ? `tab_${dragging.tabKey}` : `group_${dragging.groupId}`)
          prevUserSelect = document.body.style.userSelect
          document.body.style.userSelect = 'none'
        }

        const indicator = pickDropIndicatorFromPoint(ev.clientX, ev.clientY, dragging)
        setDropIndicator(indicator)
        if (indicator.kind === 'none') setDragOverKey('')
        else if (indicator.kind === 'group-slot') setDragOverKey(`group_${indicator.groupId}`)
        else setDragOverKey('container')
      }

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        if (started) {
          const indicator = pickDropIndicatorFromPoint(ev.clientX, ev.clientY, dragging)
          if (dragging.kind === 'tab') {
            if (indicator.kind === 'top-slot') onMoveTabToUngroupedIndex(dragging.tabKey, indicator.index)
            if (indicator.kind === 'group-slot') onMoveTabToGroupIndex(dragging.tabKey, indicator.groupId, indicator.index)
          } else if (dragging.kind === 'group') {
            if (indicator.kind === 'top-slot') onMoveGroupToIndex(dragging.groupId, indicator.index)
          }
        }
        cleanup()
      }

      const dispose = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
        if (started) document.body.style.userSelect = prevUserSelect
        setDraggingKey('')
        setDragOverKey('')
        setDropIndicator({ kind: 'none' })
        setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }

      cleanupRef.current = dispose
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    },
    [cleanup, enabled, onMoveGroupToIndex, onMoveTabToGroupIndex, onMoveTabToUngroupedIndex],
  )

  const containerProps = React.useMemo(() => (enabled ? { 'data-hc-dnd-container': '1' as const } : {}), [enabled])

  const getTabProps = React.useCallback(
    (tabKey: string) => ({
      'data-hc-dnd-tab-key': tabKey,
      onPointerDown: (e: React.PointerEvent) => begin({ kind: 'tab', tabKey }, e),
    }),
    [begin],
  )

  const getGroupProps = React.useCallback(
    (groupId: string) => ({
      'data-hc-dnd-group-id': groupId,
      onPointerDown: (e: React.PointerEvent) => begin({ kind: 'group', groupId }, e),
    }),
    [begin],
  )

  return { containerProps, getTabProps, getGroupProps, dragOverKey, draggingKey, dropIndicator, suppressClickRef }
}
