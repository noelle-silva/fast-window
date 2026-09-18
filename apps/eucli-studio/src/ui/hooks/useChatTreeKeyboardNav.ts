import * as React from 'react'

export function useChatTreeKeyboardNav(deps: {
  treeOpen: boolean
  effectiveTreeView: 'right' | 'float'
  treeDir: 'lr' | 'tb' | 'bt' | 'rl'
  treeRender: any
  treeFocusMid: string
  getLastMsgId: () => string
  jumpToMessage: (mid: string) => void
  closeTreeModal: (focusComposer: boolean) => void
}) {
  const { treeOpen, effectiveTreeView, treeDir, treeRender, treeFocusMid, getLastMsgId, jumpToMessage, closeTreeModal } = deps

  // 分支树（悬浮模态窗）：键盘方向键切换选中节点（按“深度/平级/分支最深”策略）
  React.useEffect(() => {
    if (!treeOpen || effectiveTreeView !== 'float') return
    const tr: any = treeRender
    if (!tr || !Array.isArray(tr.nodes) || tr.nodes.length === 0) return
    const byId = tr?.byId
    if (!byId || typeof byId.get !== 'function') return

    const nodes = tr.nodes as any[]

    const nodesAtDepth = new Map<number, any[]>()
    const childrenById = new Map<string, any[]>()
    const hasChild = new Set<string>()

    for (const n of nodes) {
      const id = String(n?.id || '').trim()
      if (!id) continue
      const depth = Math.floor(Number(n?.depth || 0))
      const list = nodesAtDepth.get(depth) || []
      list.push(n)
      nodesAtDepth.set(depth, list)

      const pid = String(n?.parentId || '').trim()
      if (pid) {
        hasChild.add(pid)
        const kids = childrenById.get(pid) || []
        kids.push(n)
        childrenById.set(pid, kids)
      }
    }

    const sortByLane = (a: any, b: any) => {
      const la = Number(a?.lane ?? Number.POSITIVE_INFINITY)
      const lb = Number(b?.lane ?? Number.POSITIVE_INFINITY)
      if (la !== lb) return la - lb
      const da = Math.floor(Number(a?.depth || 0))
      const db = Math.floor(Number(b?.depth || 0))
      if (da !== db) return da - db
      return String(a?.id || '').localeCompare(String(b?.id || ''))
    }

    for (const [d, list] of nodesAtDepth.entries()) nodesAtDepth.set(d, list.slice().sort(sortByLane))
    for (const [pid, kids] of childrenById.entries()) childrenById.set(pid, kids.slice().sort(sortByLane))

    const leaves = nodes.filter((n) => {
      const id = String(n?.id || '').trim()
      if (!id) return false
      return !hasChild.has(id)
    })
    leaves.sort(sortByLane)

    const onKeyDown = (e: KeyboardEvent) => {
      if (!treeOpen || effectiveTreeView !== 'float') return
      if (e.defaultPrevented) return
      if ((e as any).isComposing) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const target = e.target as any
      const tag = String(target?.tagName || '').toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA' || !!target?.isContentEditable) return

      const key = String(e.key || '')
      const isArrow = key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'
      if (!isArrow) return

      const action = (() => {
        // 让方向键按“屏幕方向”适配 4 种树生长方向：
        // - 深度轴（父/子）跟随树的生长方向；
        // - 平级（lane）轴跟随与深度轴正交的方向。
        if (treeDir === 'tb') {
          if (key === 'ArrowUp') return 'parent'
          if (key === 'ArrowDown') return 'child'
          if (key === 'ArrowLeft') return 'lanePrev'
          return 'laneNext'
        }
        if (treeDir === 'bt') {
          if (key === 'ArrowDown') return 'parent'
          if (key === 'ArrowUp') return 'child'
          if (key === 'ArrowLeft') return 'lanePrev'
          return 'laneNext'
        }
        if (treeDir === 'lr') {
          if (key === 'ArrowLeft') return 'parent'
          if (key === 'ArrowRight') return 'child'
          if (key === 'ArrowUp') return 'lanePrev'
          return 'laneNext'
        }
        // rl
        if (key === 'ArrowRight') return 'parent'
        if (key === 'ArrowLeft') return 'child'
        if (key === 'ArrowUp') return 'lanePrev'
        return 'laneNext'
      })() as 'parent' | 'child' | 'lanePrev' | 'laneNext'

      const pickStartId = () => {
        const a = String(treeFocusMid || '').trim()
        if (a && byId.get(a)) return a
        const b = String(getLastMsgId() || '').trim()
        if (b && byId.get(b)) return b
        const first = tr.nodes.find((n: any) => !!String(n?.id || '').trim()) || null
        const fid = String(first?.id || '').trim()
        return fid && byId.get(fid) ? fid : ''
      }

      const curId = pickStartId()
      const cur = curId ? byId.get(curId) : null
      if (!cur) return

      const curDepth = Math.floor(Number(cur?.depth || 0))
      const curLane = Number(cur?.lane ?? 0)

      // 策略：
      // - 平级：在“同深度”上按 lane 移动；如果同深度边界无节点，则按 lane 去找“相邻分支”的叶子（最深节点）。
      // - 深度：parent/child。
      let nextId = ''
      if (action === 'lanePrev') {
        const list = nodesAtDepth.get(curDepth) || []
        const idx = list.findIndex((x: any) => String(x?.id || '').trim() === curId)
        if (idx > 0) nextId = String(list[idx - 1]?.id || '').trim()
        else {
          const cand = list
            .slice()
            .reverse()
            .find((x: any) => Number(x?.lane ?? Number.POSITIVE_INFINITY) < curLane && String(x?.id || '').trim() !== curId)
          nextId = cand ? String(cand?.id || '').trim() : ''
        }
        if (!nextId) {
          const leaf = leaves
            .slice()
            .reverse()
            .find((x: any) => Number(x?.lane ?? Number.POSITIVE_INFINITY) < curLane && String(x?.id || '').trim() !== curId)
          nextId = leaf ? String(leaf?.id || '').trim() : ''
        }
      } else if (action === 'laneNext') {
        const list = nodesAtDepth.get(curDepth) || []
        const idx = list.findIndex((x: any) => String(x?.id || '').trim() === curId)
        if (idx >= 0 && idx + 1 < list.length) nextId = String(list[idx + 1]?.id || '').trim()
        else {
          const cand = list.find((x: any) => Number(x?.lane ?? Number.POSITIVE_INFINITY) > curLane && String(x?.id || '').trim() !== curId)
          nextId = cand ? String(cand?.id || '').trim() : ''
        }
        if (!nextId) {
          const leaf = leaves.find((x: any) => Number(x?.lane ?? Number.POSITIVE_INFINITY) > curLane && String(x?.id || '').trim() !== curId)
          nextId = leaf ? String(leaf?.id || '').trim() : ''
        }
      } else if (action === 'parent') {
        const pid = String(cur?.parentId || '').trim()
        if (pid && byId.get(pid)) nextId = pid
      } else if (action === 'child') {
        const kids = childrenById.get(curId) || []
        if (kids.length === 1) nextId = String(kids[0]?.id || '').trim()
        else if (kids.length > 1) {
          let best = ''
          let bestD = Number.POSITIVE_INFINITY
          for (const k of kids) {
            const id = String(k?.id || '').trim()
            if (!id || !byId.get(id)) continue
            const lane = Number(k?.lane ?? Number.POSITIVE_INFINITY)
            const d = Math.abs(lane - curLane)
            if (d < bestD) {
              bestD = d
              best = id
            }
          }
          nextId = best
        }
      }

      if (!nextId || nextId === curId) return
      e.preventDefault()
      e.stopPropagation()
      jumpToMessage(nextId)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [treeOpen, effectiveTreeView, treeDir, treeRender, treeFocusMid, getLastMsgId, jumpToMessage])

  // 分支树（悬浮模态窗）：按 Enter 关闭
  React.useEffect(() => {
    if (!treeOpen || effectiveTreeView !== 'float') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!treeOpen || effectiveTreeView !== 'float') return
      if (e.defaultPrevented) return
      if ((e as any).isComposing) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (String(e.key || '') !== 'Enter') return

      const target = e.target as any
      const tag = String(target?.tagName || '').toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA' || !!target?.isContentEditable) return

      e.preventDefault()
      e.stopPropagation()
      closeTreeModal(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [treeOpen, effectiveTreeView, closeTreeModal])
}
