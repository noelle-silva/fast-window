import * as React from 'react'
import type { HyperCortexTabGroupV1 } from '../core'

type DropPos = 'before' | 'after'

type DndHit =
  | { type: 'container'; el: HTMLElement }
  | { type: 'tab'; el: HTMLElement; tabKey: string }
  | { type: 'group'; el: HTMLElement; groupId: string }

function getDropPosFromY(clientY: number, el: HTMLElement): DropPos {
  const rect = el.getBoundingClientRect()
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function moveId(list: string[], movingId: string, anchorId: string, pos: DropPos): string[] {
  const mid = String(movingId || '').trim()
  const aid = String(anchorId || '').trim()
  if (!mid || !aid || mid === aid) return list
  if (!list.includes(mid) || !list.includes(aid)) return list
  const without = list.filter(x => x !== mid)
  const anchorIdx = without.indexOf(aid)
  if (anchorIdx < 0) return list
  const insertIdx = pos === 'before' ? anchorIdx : anchorIdx + 1
  return [...without.slice(0, insertIdx), mid, ...without.slice(insertIdx)]
}

function moveGroupBlock(
  openKeys: string[],
  movingGroupId: string,
  anchor: { kind: 'tab'; tabKey: string } | { kind: 'group'; groupId: string },
  pos: DropPos,
  byTabKey: Record<string, string>,
): string[] {
  const gid = String(movingGroupId || '').trim()
  if (!gid) return openKeys
  const block = openKeys.filter(key => String(byTabKey[key] || '').trim() === gid)
  if (!block.length) return openKeys
  const remaining = openKeys.filter(key => String(byTabKey[key] || '').trim() !== gid)

  let insertIdx = remaining.length
  if (anchor.kind === 'tab') {
    const idx = remaining.indexOf(anchor.tabKey)
    if (idx >= 0) insertIdx = pos === 'before' ? idx : idx + 1
  } else {
    const anchorGid = String(anchor.groupId || '').trim()
    if (anchorGid) {
      let firstIdx = -1
      let lastIdx = -1
      for (let i = 0; i < remaining.length; i++) {
        const key = remaining[i]
        if (String(byTabKey[key] || '').trim() !== anchorGid) continue
        if (firstIdx < 0) firstIdx = i
        lastIdx = i
      }
      if (firstIdx >= 0) insertIdx = pos === 'before' ? firstIdx : lastIdx + 1
    }
  }

  return [...remaining.slice(0, insertIdx), ...block, ...remaining.slice(insertIdx)]
}

function pickDndHit(el: Element | null): DndHit | null {
  if (!el) return null
  const tabEl = (el as any).closest?.('[data-hc-dnd-tab-key]') as HTMLElement | null
  if (tabEl) return { type: 'tab', el: tabEl, tabKey: String(tabEl.getAttribute('data-hc-dnd-tab-key') || '').trim() }
  const groupEl = (el as any).closest?.('[data-hc-dnd-group-id]') as HTMLElement | null
  if (groupEl) return { type: 'group', el: groupEl, groupId: String(groupEl.getAttribute('data-hc-dnd-group-id') || '').trim() }
  const containerEl = (el as any).closest?.('[data-hc-dnd-container]') as HTMLElement | null
  if (containerEl) return { type: 'container', el: containerEl }
  return null
}

function isNoDragTarget(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null
  if (!el) return false
  if (el.closest('[data-hc-no-drag="1"]')) return true
  if (el.closest('button, a, input, textarea, select, option')) return true
  return false
}

export type OpenTabsPointerDndOptions = {
  openTabKeys: string[]
  tabGroups: HyperCortexTabGroupV1[]
  tabGroupByTabKey: Record<string, string>
  isValidGroupId: (groupId: string) => boolean
  onAssignTabToGroup: (tabKey: string, groupId: string) => void
  onUnassignTabFromGroup: (tabKey: string) => void
  onReorderOpenTabs: (nextOpenTabKeys: string[]) => void
  onReorderTabGroups: (nextGroupIds: string[]) => void
}

export function useOpenTabsPointerDnd(opts: OpenTabsPointerDndOptions) {
  const {
    openTabKeys,
    tabGroups,
    tabGroupByTabKey,
    isValidGroupId,
    onAssignTabToGroup,
    onUnassignTabFromGroup,
    onReorderOpenTabs,
    onReorderTabGroups,
  } = opts

  const [dragOverKey, setDragOverKey] = React.useState<string>('')
  const [draggingKey, setDraggingKey] = React.useState<string>('')
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
    (kind: 'tab' | 'group', id: string, e: React.PointerEvent) => {
      if (e.button !== 0) return
      const dragId = String(id || '').trim()
      if (!dragId) return
      if (isNoDragTarget(e.target)) return
      cleanup()

      try {
        ;(e.currentTarget as any)?.setPointerCapture?.(e.pointerId)
      } catch {
      }

      const pointerId = e.pointerId
      const startX = e.clientX
      const startY = e.clientY
      let started = false
      const startThreshold = 4
      let prevUserSelect = ''

      const setOverFromHit = (hit: DndHit | null) => {
        if (!hit) return setDragOverKey('')
        if (hit.type === 'container') return setDragOverKey('container')
        if (hit.type === 'tab') return setDragOverKey(`tab_${hit.tabKey}`)
        return setDragOverKey(`group_${hit.groupId}`)
      }

      const commitDrop = (hit: DndHit | null, clientY: number) => {
        if (!hit) return

        if (kind === 'tab') {
          const tabKey = dragId
          if (hit.type === 'container') return onUnassignTabFromGroup(tabKey)

          if (hit.type === 'group') {
            const gid = String(hit.groupId || '').trim()
            if (!gid || !isValidGroupId(gid)) return
            onAssignTabToGroup(tabKey, gid)

            const tempByTabKey = { ...tabGroupByTabKey, [tabKey]: gid }
            const others = openTabKeys.filter(x => x !== tabKey && String(tempByTabKey[x] || '').trim() === gid)
            const last = others[others.length - 1] || ''
            if (last) onReorderOpenTabs(moveId(openTabKeys, tabKey, last, 'after'))
            return
          }

          if (hit.type === 'tab') {
            const targetTabKey = hit.tabKey
            if (!targetTabKey || targetTabKey === tabKey) return
            const pos = getDropPosFromY(clientY, hit.el)
            onReorderOpenTabs(moveId(openTabKeys, tabKey, targetTabKey, pos))

            const targetMapped = String(tabGroupByTabKey[targetTabKey] || '').trim()
            if (targetMapped && isValidGroupId(targetMapped)) onAssignTabToGroup(tabKey, targetMapped)
            else onUnassignTabFromGroup(tabKey)
          }
          return
        }

        const movingGroupId = dragId
        const movingHasTabs = openTabKeys.some(x => String(tabGroupByTabKey[x] || '').trim() === movingGroupId)

        if (hit.type === 'tab') {
          if (!movingHasTabs) return
          const pos = getDropPosFromY(clientY, hit.el)
          onReorderOpenTabs(moveGroupBlock(openTabKeys, movingGroupId, { kind: 'tab', tabKey: hit.tabKey }, pos, tabGroupByTabKey))
          return
        }

        if (hit.type !== 'group') return
        const targetGroupId = hit.groupId
        if (!targetGroupId || targetGroupId === movingGroupId) return

        const pos = getDropPosFromY(clientY, hit.el)
        const targetHasTabs = openTabKeys.some(x => String(tabGroupByTabKey[x] || '').trim() === targetGroupId)

        if (movingHasTabs && targetHasTabs) {
          onReorderOpenTabs(moveGroupBlock(openTabKeys, movingGroupId, { kind: 'group', groupId: targetGroupId }, pos, tabGroupByTabKey))
          return
        }

        if (!movingHasTabs) {
          const ids = tabGroups.map(g => g.id)
          onReorderTabGroups(moveId(ids, movingGroupId, targetGroupId, pos))
          return
        }

        if (movingHasTabs && !targetHasTabs) {
          const block = openTabKeys.filter(x => String(tabGroupByTabKey[x] || '').trim() === movingGroupId)
          const remaining = openTabKeys.filter(x => String(tabGroupByTabKey[x] || '').trim() !== movingGroupId)
          onReorderOpenTabs([...remaining, ...block])
        }
      }

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (!started) {
          if (Math.hypot(dx, dy) < startThreshold) return
          started = true
          suppressClickRef.current = true
          setDraggingKey(`${kind}_${dragId}`)
          prevUserSelect = document.body.style.userSelect
          document.body.style.userSelect = 'none'
        }
        const hit = pickDndHit(document.elementFromPoint(ev.clientX, ev.clientY))
        setOverFromHit(hit)
      }

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        const hit = started ? pickDndHit(document.elementFromPoint(ev.clientX, ev.clientY)) : null
        if (started) commitDrop(hit, ev.clientY)
        cleanup()
      }

      const dispose = () => {
        window.removeEventListener('pointermove', onMove, true as any)
        window.removeEventListener('pointerup', onUp, true as any)
        window.removeEventListener('pointercancel', onUp, true as any)
        if (started) document.body.style.userSelect = prevUserSelect
        setDraggingKey('')
        setDragOverKey('')
        setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }

      cleanupRef.current = dispose
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    },
    [cleanup, isValidGroupId, onAssignTabToGroup, onReorderOpenTabs, onReorderTabGroups, onUnassignTabFromGroup, openTabKeys, tabGroupByTabKey, tabGroups],
  )

  const containerProps = React.useMemo(() => ({ 'data-hc-dnd-container': '1' as const }), [])

  const getTabProps = React.useCallback(
    (tabKey: string) => ({
      'data-hc-dnd-tab-key': tabKey,
      onPointerDown: (e: React.PointerEvent) => begin('tab', tabKey, e),
    }),
    [begin],
  )

  const getGroupProps = React.useCallback(
    (groupId: string) => ({
      'data-hc-dnd-group-id': groupId,
      onPointerDown: (e: React.PointerEvent) => begin('group', groupId, e),
    }),
    [begin],
  )

  return { containerProps, getTabProps, getGroupProps, dragOverKey, draggingKey, suppressClickRef }
}
