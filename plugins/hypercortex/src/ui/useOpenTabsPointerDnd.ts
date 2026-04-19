import * as React from 'react'
import type { HyperCortexTabGroupV1 } from '../core'

type DropPos = 'before' | 'after'

type DndHit =
  | { type: 'container'; el: HTMLElement }
  | { type: 'tab'; el: HTMLElement; noteId: string }
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
  openIds: string[],
  movingGroupId: string,
  anchor: { kind: 'tab'; noteId: string } | { kind: 'group'; groupId: string },
  pos: DropPos,
  byNoteId: Record<string, string>,
): string[] {
  const gid = String(movingGroupId || '').trim()
  if (!gid) return openIds
  const block = openIds.filter(id => String(byNoteId[id] || '').trim() === gid)
  if (!block.length) return openIds
  const remaining = openIds.filter(id => String(byNoteId[id] || '').trim() !== gid)

  let insertIdx = remaining.length
  if (anchor.kind === 'tab') {
    const idx = remaining.indexOf(anchor.noteId)
    if (idx >= 0) insertIdx = pos === 'before' ? idx : idx + 1
  } else {
    const anchorGid = String(anchor.groupId || '').trim()
    if (anchorGid) {
      let firstIdx = -1
      let lastIdx = -1
      for (let i = 0; i < remaining.length; i++) {
        const id = remaining[i]
        if (String(byNoteId[id] || '').trim() !== anchorGid) continue
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
  const tabEl = (el as any).closest?.('[data-hc-dnd-tab-id]') as HTMLElement | null
  if (tabEl) return { type: 'tab', el: tabEl, noteId: String(tabEl.getAttribute('data-hc-dnd-tab-id') || '').trim() }
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
  openNoteIds: string[]
  tabGroups: HyperCortexTabGroupV1[]
  tabGroupByNoteId: Record<string, string>
  isValidGroupId: (groupId: string) => boolean
  onAssignTabToGroup: (noteId: string, groupId: string) => void
  onUnassignTabFromGroup: (noteId: string) => void
  onReorderOpenTabs: (nextOpenNoteIds: string[]) => void
  onReorderTabGroups: (nextGroupIds: string[]) => void
}

export function useOpenTabsPointerDnd(opts: OpenTabsPointerDndOptions) {
  const {
    openNoteIds,
    tabGroups,
    tabGroupByNoteId,
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
        if (hit.type === 'tab') return setDragOverKey(`tab_${hit.noteId}`)
        return setDragOverKey(`group_${hit.groupId}`)
      }

      const commitDrop = (hit: DndHit | null, clientY: number) => {
        if (!hit) return

        if (kind === 'tab') {
          const noteId = dragId
          if (hit.type === 'container') return onUnassignTabFromGroup(noteId)

          if (hit.type === 'group') {
            const gid = String(hit.groupId || '').trim()
            if (!gid || !isValidGroupId(gid)) return
            onAssignTabToGroup(noteId, gid)

            const tempByNoteId = { ...tabGroupByNoteId, [noteId]: gid }
            const others = openNoteIds.filter(x => x !== noteId && String(tempByNoteId[x] || '').trim() === gid)
            const last = others[others.length - 1] || ''
            if (last) onReorderOpenTabs(moveId(openNoteIds, noteId, last, 'after'))
            return
          }

          if (hit.type === 'tab') {
            const targetNoteId = hit.noteId
            if (!targetNoteId || targetNoteId === noteId) return
            const pos = getDropPosFromY(clientY, hit.el)
            onReorderOpenTabs(moveId(openNoteIds, noteId, targetNoteId, pos))

            const targetMapped = String(tabGroupByNoteId[targetNoteId] || '').trim()
            if (targetMapped && isValidGroupId(targetMapped)) onAssignTabToGroup(noteId, targetMapped)
            else onUnassignTabFromGroup(noteId)
          }
          return
        }

        const movingGroupId = dragId
        const movingHasTabs = openNoteIds.some(x => String(tabGroupByNoteId[x] || '').trim() === movingGroupId)

        if (hit.type === 'tab') {
          if (!movingHasTabs) return
          const pos = getDropPosFromY(clientY, hit.el)
          onReorderOpenTabs(moveGroupBlock(openNoteIds, movingGroupId, { kind: 'tab', noteId: hit.noteId }, pos, tabGroupByNoteId))
          return
        }

        if (hit.type !== 'group') return
        const targetGroupId = hit.groupId
        if (!targetGroupId || targetGroupId === movingGroupId) return

        const pos = getDropPosFromY(clientY, hit.el)
        const targetHasTabs = openNoteIds.some(x => String(tabGroupByNoteId[x] || '').trim() === targetGroupId)

        if (movingHasTabs && targetHasTabs) {
          onReorderOpenTabs(moveGroupBlock(openNoteIds, movingGroupId, { kind: 'group', groupId: targetGroupId }, pos, tabGroupByNoteId))
          return
        }

        if (!movingHasTabs) {
          const ids = tabGroups.map(g => g.id)
          onReorderTabGroups(moveId(ids, movingGroupId, targetGroupId, pos))
          return
        }

        if (movingHasTabs && !targetHasTabs) {
          const block = openNoteIds.filter(x => String(tabGroupByNoteId[x] || '').trim() === movingGroupId)
          const remaining = openNoteIds.filter(x => String(tabGroupByNoteId[x] || '').trim() !== movingGroupId)
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
    [cleanup, isValidGroupId, onAssignTabToGroup, onReorderOpenTabs, onReorderTabGroups, onUnassignTabFromGroup, openNoteIds, tabGroupByNoteId, tabGroups],
  )

  const containerProps = React.useMemo(() => ({ 'data-hc-dnd-container': '1' as const }), [])

  const getTabProps = React.useCallback(
    (noteId: string) => ({
      'data-hc-dnd-tab-id': noteId,
      onPointerDown: (e: React.PointerEvent) => begin('tab', noteId, e),
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

