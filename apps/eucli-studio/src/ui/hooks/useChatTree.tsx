import * as React from 'react'
import { isAssistantGenerating } from '../../domain/assistantRunState'
import { activeRunCardForAssistantMessage, isStaleAssistantPlaceholder } from '../../domain/chatMessageDisplay'
import { buildChatTreeLayout } from '../chatTree/chatTreeLayout'
import { hotkeyFromKeyEvent, normalizeHotkeyString } from '../utils/hotkeys'
import { clampNum } from '../utils/numbers'
import { useEvent } from './useEvent'
import { useChatTreeKeyboardNav } from './useChatTreeKeyboardNav'

export function useChatTree(deps: {
  controller: any
  data: any
  activeChat: any
  renderChat: any
  renderChatId: string
  page: 'chat' | 'settings'
  composerInputRef: React.MutableRefObject<HTMLTextAreaElement | HTMLInputElement | null>
  chatPaneRef: React.MutableRefObject<HTMLDivElement | null>
  chatAllById: Map<string, any>
  chatAllMessagesRaw: any[]
  activeSessionRunCards: any[]
  activeSessionRunCardsKey: string
  activeSendPathFollowMid: string
  activeSendPathAnchorMid: string
  activeBranchHeadMid: string
  branchDraft: any
  branchDraftKey: string
  clearSendPathAnchor: () => void
  stickToBottomRef: React.MutableRefObject<boolean>
  autoScrollBlockUntilRef: React.MutableRefObject<number>
  setBranchNav: React.Dispatch<React.SetStateAction<{ mid: string; at: number }>>
  treeSuppressClickRef: React.MutableRefObject<boolean>
  getLastMsgId: () => string
}) {
  const {
    controller,
    data,
    activeChat,
    renderChat,
    renderChatId,
    page,
    composerInputRef,
    chatPaneRef,
    chatAllById,
    chatAllMessagesRaw,
    activeSessionRunCards,
    activeSessionRunCardsKey,
    activeSendPathFollowMid,
    activeSendPathAnchorMid,
    activeBranchHeadMid,
    branchDraft,
    branchDraftKey,
    clearSendPathAnchor,
    stickToBottomRef,
    autoScrollBlockUntilRef,
    setBranchNav,
    treeSuppressClickRef,
    getLastMsgId,
  } = deps

  const savedTreeDir = (() => {
    const raw = String(((data?.settings as any)?.branchTree?.dir ?? '') as any).trim()
    return raw === 'lr' || raw === 'tb' || raw === 'bt' || raw === 'rl' ? (raw as any) : 'lr'
  })() as 'lr' | 'tb' | 'bt' | 'rl'
  const savedTreeView = (() => {
    const raw = String(((data?.settings as any)?.branchTree?.view ?? '') as any).trim()
    return raw === 'right' || raw === 'float' ? (raw as any) : 'right'
  })() as 'right' | 'float'
  const savedTreeModalHotkey = (() => {
    const raw = String(((data?.settings as any)?.branchTree?.modalHotkey ?? '') as any).trim()
    return normalizeHotkeyString(raw)
  })()
  const savedTreeFollowSelected = (() => {
    const raw = (data?.settings as any)?.branchTree?.followSelected
    return typeof raw === 'boolean' ? raw : true
  })() as boolean

  const [treeOpen, setTreeOpen] = React.useState(false)
  const [treeViewOverride, setTreeViewOverride] = React.useState<'' | 'right' | 'float'>('')
  const [treePan, setTreePan] = React.useState<{ x: number; y: number }>({ x: 18, y: 18 })
  const [treeScale, setTreeScale] = React.useState(1)
  const [treeDir, setTreeDir] = React.useState<'lr' | 'tb' | 'bt' | 'rl'>(() => savedTreeDir)
  const [treeSelectedMid, setTreeSelectedMid] = React.useState('')
  const [treePop, setTreePop] = React.useState<{ id: string; at: number }>({ id: '', at: 0 })
  const [treeDragging, setTreeDragging] = React.useState(false)
  const treeDragRef = React.useRef<{ pid: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const treeViewportRef = React.useRef<SVGGElement | null>(null)
  const treeViewRef = React.useRef<{ x: number; y: number; scale: number }>({ x: 18, y: 18, scale: 1 })
  const treeViewRafRef = React.useRef<number>(0)
  const treeHostRightRef = React.useRef<HTMLDivElement | null>(null)
  const treeHostFloatRef = React.useRef<HTMLDivElement | null>(null)
  const treeFollowRafRef = React.useRef<number>(0)
  const treeFollowAnimRef = React.useRef<{ targetX: number; targetY: number; lastT: number } | null>(null)
  const treeOpenTokenRef = React.useRef(0)
  const treeInitialCenterRafRef = React.useRef<number>(0)
  const treeNeedInitialCenterRef = React.useRef(false)

  const effectiveTreeView = (treeViewOverride || savedTreeView) as 'right' | 'float'

  const [treePanelW, setTreePanelW] = React.useState(360)
  const treePanelWRef = React.useRef(360)
  const [treeResizing, setTreeResizing] = React.useState(false)
  const treeResizeRef = React.useRef<{ pid: number; right: number } | null>(null)
  const treeResizeLastXRef = React.useRef(0)
  const treeResizeRafRef = React.useRef<number>(0)

  React.useEffect(() => {
    setTreePan({ x: 18, y: 18 })
    setTreeScale(1)
    setTreeSelectedMid('')
    clearSendPathAnchor()
    treeViewRef.current = { x: 18, y: 18, scale: 1 }
  }, [String(activeChat?.id || ''), clearSendPathAnchor])

  React.useEffect(() => {
    if (treeDir === savedTreeDir) return
    setTreeDir(savedTreeDir)
  }, [savedTreeDir, treeDir])

  // float 模态窗不需要“吸附/定位”逻辑

  const applyTreeViewTransform = useEvent(() => {
    const g = treeViewportRef.current
    if (!g) return
    const v = treeViewRef.current
    const x = Math.round(Number(v?.x || 0))
    const y = Math.round(Number(v?.y || 0))
    const s = clampNum(Number(v?.scale || 1), 0.35, 2.6)
    try {
      g.setAttribute('transform', `translate(${x},${y}) scale(${s})`)
    } catch (_) {}
  })

  const scheduleTreeViewTransform = useEvent(() => {
    if (treeViewRafRef.current) return
    treeViewRafRef.current = requestAnimationFrame(() => {
      treeViewRafRef.current = 0
      applyTreeViewTransform()
    })
  })

  const stopTreeFollow = useEvent(() => {
    treeFollowAnimRef.current = null
    if (treeFollowRafRef.current) {
      cancelAnimationFrame(treeFollowRafRef.current)
      treeFollowRafRef.current = 0
    }
  })

  React.useLayoutEffect(() => {
    treeViewRef.current = { x: treePan.x, y: treePan.y, scale: treeScale }
    applyTreeViewTransform()
  }, [treeOpen, treePan.x, treePan.y, treeScale, applyTreeViewTransform])

  React.useEffect(() => {
    const id = String(treePop.id || '').trim()
    if (!id) return
    const t = window.setTimeout(() => setTreePop({ id: '', at: 0 }), 420)
    return () => window.clearTimeout(t)
  }, [treePop.id, treePop.at])

  React.useEffect(() => {
    treePanelWRef.current = treePanelW
  }, [treePanelW])

  React.useEffect(() => {
    if (treeOpen) return
    treeDragRef.current = null
    treeSuppressClickRef.current = false
    setTreeDragging(false)
    setTreeViewOverride('')
    stopTreeFollow()
  }, [treeOpen, stopTreeFollow])

  const endTreeResize = useEvent((e: React.PointerEvent) => {
    const st = treeResizeRef.current
    if (!st) return
    if (Number(e.pointerId) !== Number(st.pid)) return
    treeResizeRef.current = null
    if (treeResizeRafRef.current) {
      cancelAnimationFrame(treeResizeRafRef.current)
      treeResizeRafRef.current = 0
    }
    setTreeResizing(false)
  })

  const onTreeSplitterPointerDown = useEvent((e: React.PointerEvent) => {
    if (!treeOpen) return
    if (e.button !== 0) return
    const host = chatPaneRef.current
    let right = 0
    try {
      right = host ? Number(host.getBoundingClientRect().right || 0) : 0
    } catch (_) {
      right = 0
    }
    treeResizeLastXRef.current = Number(e.clientX || 0)
    treeResizeRef.current = { pid: Number(e.pointerId), right }
    setTreeResizing(true)
    e.preventDefault()
    e.stopPropagation()
    try {
      ;(e.currentTarget as any)?.setPointerCapture?.(e.pointerId)
    } catch (_) {}
  })

  const onTreeSplitterPointerMove = useEvent((e: React.PointerEvent) => {
    const st = treeResizeRef.current
    if (!st) return
    if (Number(e.pointerId) !== Number(st.pid)) return
    treeResizeLastXRef.current = Number(e.clientX || 0)
    if (treeResizeRafRef.current) return
    treeResizeRafRef.current = requestAnimationFrame(() => {
      treeResizeRafRef.current = 0
      const cur = treeResizeRef.current
      if (!cur) return
      const raw = Math.max(0, Number(cur.right || 0) - Number(treeResizeLastXRef.current || 0))
      const next = clampNum(Math.round(raw), 240, 860)
      setTreePanelW(next)
    })
  })

  React.useEffect(() => {
    if (!treeResizing) return
    const onUp = () => {
      treeResizeRef.current = null
      setTreeResizing(false)
    }
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [treeResizing])

  React.useEffect(() => {
    if (!treeDragging) return
    const onUp = () => {
      treeDragRef.current = null
      setTreeDragging(false)
      treeSuppressClickRef.current = false
    }
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [treeDragging])

  const focusComposerSoon = useEvent(() => {
    if (page !== 'chat') return
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = composerInputRef.current
        if (!el) return
        try {
          el.focus?.()
          const v = typeof (el as any).value === 'string' ? String((el as any).value || '') : ''
          if (typeof (el as any).setSelectionRange === 'function') (el as any).setSelectionRange(v.length, v.length)
        } catch (_) {}
      }, 0)
    })
  })

  const closeTreeModal = useEvent((focusComposer: boolean) => {
    setTreeViewOverride('')
    setTreeOpen(false)
    if (focusComposer) focusComposerSoon()
  })

  const endTreeDrag = useEvent((e: React.PointerEvent) => {
    const st = treeDragRef.current
    if (!st) return
    if (Number(e.pointerId) !== Number(st.pid)) return
    treeDragRef.current = null
    setTreeDragging(false)
    const v = treeViewRef.current
    setTreePan({ x: Number(v?.x || 0), y: Number(v?.y || 0) })
    setTreeScale(clampNum(Number(v?.scale || 1), 0.35, 2.6))
    if (st.moved) {
      treeSuppressClickRef.current = true
      setTimeout(() => {
        treeSuppressClickRef.current = false
      }, 0)
    }
  })

  const onTreePointerDown = useEvent((e: React.PointerEvent) => {
    if (!treeOpen) return
    if (e.button !== 0) return
    try {
      const t = e.target as any
      if (t && typeof t.closest === 'function' && t.closest('[data-tree-node="1"]')) return
    } catch (_) {}
    stopTreeFollow()
    treeSuppressClickRef.current = false
    const v = treeViewRef.current
    treeDragRef.current = { pid: Number(e.pointerId), sx: Number(e.clientX), sy: Number(e.clientY), ox: Number(v?.x || 0), oy: Number(v?.y || 0), moved: false }
    setTreeDragging(true)
    e.preventDefault()
    try {
      ;(e.currentTarget as any)?.setPointerCapture?.(e.pointerId)
    } catch (_) {}
  })

  const onTreePointerMove = useEvent((e: React.PointerEvent) => {
    const st = treeDragRef.current
    if (!st) return
    if (Number(e.pointerId) !== Number(st.pid)) return
    const dx = Number(e.clientX) - Number(st.sx)
    const dy = Number(e.clientY) - Number(st.sy)
    if (!st.moved && Math.hypot(dx, dy) > 3) st.moved = true
    treeViewRef.current = { ...treeViewRef.current, x: st.ox + dx, y: st.oy + dy }
    scheduleTreeViewTransform()
  })

  const onTreeWheel = useEvent((e: React.WheelEvent) => {
    if (!treeOpen) return
    const el = e.currentTarget as HTMLElement | null
    if (!el) return
    const dy = Number((e as any)?.deltaY || 0)
    if (!isFinite(dy) || dy === 0) return
    e.preventDefault()

    const rect = el.getBoundingClientRect()
    const cx = Number(e.clientX) - Number(rect.left)
    const cy = Number(e.clientY) - Number(rect.top)

    const scale0 = Number(treeViewRef.current?.scale || 1)
    const factor = dy > 0 ? 1 / 1.12 : 1.12
    const nextScale = clampNum(scale0 * factor, 0.35, 2.6)
    if (Math.abs(nextScale - scale0) < 1e-6) return

    const pan0 = treeViewRef.current
    const wx = (cx - Number(pan0?.x || 0)) / scale0
    const wy = (cy - Number(pan0?.y || 0)) / scale0
    const nx = cx - wx * nextScale
    const ny = cy - wy * nextScale

    treeViewRef.current = { x: nx, y: ny, scale: nextScale }
    scheduleTreeViewTransform()
  })

  // 分支树：Ctrl + 上/下 缩放（以视窗中心为锚点）
  React.useEffect(() => {
    if (!treeOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!treeOpen) return
      if (e.defaultPrevented) return
      if ((e as any).isComposing) return
      if (!e.ctrlKey) return

      const key = String(e.key || '')
      if (key !== 'ArrowUp' && key !== 'ArrowDown') return

      const target = e.target as any
      const tag = String(target?.tagName || '').toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable) return

      const host = (effectiveTreeView === 'float' ? treeHostFloatRef.current : treeHostRightRef.current) as HTMLDivElement | null
      if (!host) return
      const w = Number(host.clientWidth || 0)
      const h = Number(host.clientHeight || 0)
      if (w < 20 || h < 20) return

      e.preventDefault()
      e.stopPropagation()

      stopTreeFollow()

      const cx = w / 2
      const cy = h / 2

      const scale0 = Number(treeViewRef.current?.scale || 1)
      const factor = key === 'ArrowUp' ? 1.12 : 1 / 1.12
      const nextScale = clampNum(scale0 * factor, 0.35, 2.6)
      if (Math.abs(nextScale - scale0) < 1e-6) return

      const pan0 = treeViewRef.current
      const wx = (cx - Number(pan0?.x || 0)) / scale0
      const wy = (cy - Number(pan0?.y || 0)) / scale0
      const nx = cx - wx * nextScale
      const ny = cy - wy * nextScale

      treeViewRef.current = { x: nx, y: ny, scale: nextScale }
      scheduleTreeViewTransform()
      setTreePan({ x: nx, y: ny })
      setTreeScale(nextScale)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [treeOpen, effectiveTreeView, scheduleTreeViewTransform, stopTreeFollow])

  const cycleTreeDir = useEvent(() => {
    const order: Array<'lr' | 'tb' | 'bt' | 'rl'> = ['lr', 'tb', 'bt', 'rl']
    const i = Math.max(0, order.indexOf(treeDir))
    const next = order[(i + 1) % order.length]
    setTreeDir(next)
    controller.actions.setBranchTreeDir?.(next)
    setTreePan({ x: 18, y: 18 })
    setTreeScale(1)
    treeViewRef.current = { x: 18, y: 18, scale: 1 }
    scheduleTreeViewTransform()
  })

  const treeLayout = React.useMemo(() => {
    if (!renderChat || !treeOpen) return null
    const treeMessages = chatAllMessagesRaw.filter((message: any) => {
      const hasActiveRun = !!activeRunCardForAssistantMessage(activeSessionRunCards, message) && isAssistantGenerating(message)
      return !isStaleAssistantPlaceholder(message, hasActiveRun)
    })
    return buildChatTreeLayout(treeMessages, { maxNodes: 900 })
  }, [renderChatId, Number((renderChat as any)?.updatedAt || 0), treeOpen, chatAllMessagesRaw.length, activeSessionRunCardsKey])

  const treeRender = React.useMemo(() => {
    const tl: any = treeLayout
    if (!tl || !Array.isArray(tl.nodes) || tl.nodes.length === 0) return null

    const nodeW = Number(tl.nodeW || 168)
    const nodeH = Number(tl.nodeH || 44)
    const gapX = Number(tl.gapX || 120)
    const gapY = Number(tl.gapY || 70)
    const pad = Number(tl.pad || 22)
    const maxDepth = Math.max(0, Math.floor(Number(tl.maxDepth || 0)))
    const maxLane = Math.max(0, Number(tl.maxLane || 0))

    const stepDepthX = nodeW + gapX
    const stepDepthY = nodeH + gapY
    const stepLaneX = nodeW + gapX
    const stepLaneY = gapY

    const nodes = (tl.nodes as any[]).map((n: any) => {
      const depth = Math.max(0, Math.floor(Number(n?.depth || 0)))
      const lane = Math.max(0, Number(n?.lane || 0))
      let x = 0
      let y = 0

      if (treeDir === 'lr' || treeDir === 'rl') {
        const d = treeDir === 'rl' ? maxDepth - depth : depth
        x = pad + d * stepDepthX
        y = pad + lane * stepLaneY
      } else {
        const d = treeDir === 'bt' ? maxDepth - depth : depth
        x = pad + lane * stepLaneX
        y = pad + d * stepDepthY
      }

      return { ...n, depth, lane, x, y }
    })

    const byId = new Map<string, any>()
    for (const n of nodes) {
      const id = String(n?.id || '').trim()
      if (id && !byId.has(id)) byId.set(id, n)
    }

    const edges = Array.isArray(tl.edges) ? (tl.edges as any[]) : []

    let maxX = 0
    let maxY = 0
    for (const n of nodes) {
      maxX = Math.max(maxX, Number(n.x || 0) + nodeW)
      maxY = Math.max(maxY, Number(n.y || 0) + nodeH)
    }

    const size = { w: maxX + pad, h: maxY + pad }
    return { nodes, edges, byId, nodeW, nodeH, size }
  }, [treeLayout, treeDir])

  const treeFocusMid = String(treeSelectedMid || activeSendPathFollowMid || activeSendPathAnchorMid || '').trim()

  const jumpToMessage = useEvent((mid0: string) => {
    // 重要：树视图的缩放/平移是用 ref 更新的（为了性能不频繁 setState）。
    // 但一旦触发 React render（比如点击节点），useLayoutEffect 会用 treePan/treeScale 覆盖 ref。
    // 所以这里先把 ref 的最新值同步回 state，避免“缩放后第一次点击不居中、第二次才正常”的错位。
    const vv = treeViewRef.current
    setTreePan({ x: Number(vv?.x || 0), y: Number(vv?.y || 0) })
    setTreeScale(clampNum(Number(vv?.scale || 1), 0.35, 2.6))

    const mid = String(mid0 || '').trim()
    if (!mid) return
    if (!activeChat) return
    const msg = chatAllById.get(mid) || null
    if (!msg) return
    clearSendPathAnchor()
    setTreeSelectedMid(mid)

    const branching = (activeChat as any)?.branching
    const curBid = String(branching?.activeBranchId || 'main').trim() || 'main'
    const branches = Array.isArray(branching?.branches) ? branching.branches : []

    const containsMid = (headMid0: any) => {
      let cur = String(headMid0 || '').trim()
      const seen = new Set<string>()
      let guard = 0
      while (cur && !seen.has(cur) && guard < 6000) {
        guard++
        seen.add(cur)
        if (cur === mid) return true
        const m = chatAllById.get(cur) || null
        if (!m) break
        cur = String((m as any)?.parentMid || '').trim()
      }
      return false
    }

    const rawBid = String((msg as any)?.branchId || '').trim()
    let bid = rawBid || curBid || 'main'

    const curBranch = branches.find((b: any) => String(b?.id || '').trim() === curBid) || null
    const curHead = String((curBranch as any)?.headMid || '').trim()
    if (curHead && containsMid(curHead)) bid = curBid || bid
    else {
      let picked = ''
      for (const b of branches) {
        const id = String(b?.id || '').trim()
        const head = String((b as any)?.headMid || '').trim()
        if (!id || !head) continue
        if (!containsMid(head)) continue
        picked = id
        break
      }
      if (picked) bid = picked
    }

    stickToBottomRef.current = false
    autoScrollBlockUntilRef.current = Date.now() + 1200
    setBranchNav({ mid, at: Date.now() })
    if (bid && bid !== curBid) controller.actions.setActiveBranch?.(bid)
  })

  // 选中节点 → 视角自动追踪到中心（可开关，全局持久化）
  React.useEffect(() => {
    stopTreeFollow()
    if (!treeOpen) return
    if (!savedTreeFollowSelected) return
    const mid = String(treeFocusMid || '').trim()
    if (!mid) return
    const tr: any = treeRender
    if (!tr || !tr.byId || typeof tr.byId.get !== 'function') return

    const node = tr.byId.get(mid) || null
    if (!node) return

    const host = (effectiveTreeView === 'float' ? treeHostFloatRef.current : treeHostRightRef.current) as HTMLDivElement | null
    if (!host) return
    const w = Number(host.clientWidth || 0)
    const h = Number(host.clientHeight || 0)
    if (w < 20 || h < 20) return

    const nodeW = Number(tr.nodeW || 168)
    const nodeH = Number(tr.nodeH || 44)
    const wx = Number(node?.x || 0) + nodeW / 2
    const wy = Number(node?.y || 0) + nodeH / 2

    const v0 = treeViewRef.current
    const s = clampNum(Number(v0?.scale || 1), 0.35, 2.6)
    const cx = w / 2
    const cy = h / 2
    const targetX = cx - wx * s
    const targetY = cy - wy * s

    const start = () => {
      const speed = 1800 // px / s（屏幕坐标）
      const tick = (t: number) => {
        treeFollowRafRef.current = 0
        if (!treeOpen || !savedTreeFollowSelected) {
          treeFollowAnimRef.current = null
          return
        }
        if (treeDragRef.current) {
          treeFollowAnimRef.current = null
          return
        }

        const a = treeFollowAnimRef.current
        if (!a) return

        const last = Number(a.lastT || 0) || t
        const dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000))
        a.lastT = t

        const v = treeViewRef.current
        const x0 = Number(v?.x || 0)
        const y0 = Number(v?.y || 0)
        const dx = Number(a.targetX) - x0
        const dy = Number(a.targetY) - y0
        const dist = Math.hypot(dx, dy)

        if (dist < 0.8) {
          treeViewRef.current = { ...treeViewRef.current, x: Number(a.targetX), y: Number(a.targetY) }
          scheduleTreeViewTransform()
          setTreePan({ x: Number(a.targetX), y: Number(a.targetY) })
          treeFollowAnimRef.current = null
          return
        }

        const step = Math.min(dist, speed * dt)
        const nx = x0 + (dx / dist) * step
        const ny = y0 + (dy / dist) * step
        treeViewRef.current = { ...treeViewRef.current, x: nx, y: ny }
        scheduleTreeViewTransform()

        treeFollowRafRef.current = requestAnimationFrame(tick)
      }

      treeFollowAnimRef.current = { targetX, targetY, lastT: performance.now() }
      treeFollowRafRef.current = requestAnimationFrame(tick)
    }

    start()
    return () => stopTreeFollow()
  }, [treeOpen, effectiveTreeView, savedTreeFollowSelected, treeFocusMid, treeRender, scheduleTreeViewTransform, stopTreeFollow])

  useChatTreeKeyboardNav({
    treeOpen,
    effectiveTreeView,
    treeDir,
    treeRender,
    treeFocusMid,
    getLastMsgId,
    jumpToMessage,
    closeTreeModal,
  })
  // 全局：快捷键打开/关闭“分支树模态窗”（不改变默认显示方式）
  React.useEffect(() => {
    if (page !== 'chat') return
    const hk = String(savedTreeModalHotkey || '').trim()
    if (!hk) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if ((e as any).isComposing) return
      const cur = hotkeyFromKeyEvent(e)
      if (!cur || cur !== hk) return

      e.preventDefault()
      e.stopPropagation()

      if (treeOpen && effectiveTreeView === 'float') {
        closeTreeModal(true)
        return
      }

      setTreeViewOverride('float')
      setTreeOpen(true)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [page, savedTreeModalHotkey, treeOpen, effectiveTreeView, closeTreeModal])

  // 打开分支树时：让视角先落在“当前选中节点”上（默认取当前分支 head）
  React.useEffect(() => {
    if (!treeOpen) return
    treeOpenTokenRef.current++
    treeNeedInitialCenterRef.current = true
  }, [treeOpen, effectiveTreeView, String(activeChat?.id || '')])

  React.useEffect(() => {
    if (!treeOpen) return
    if (!treeNeedInitialCenterRef.current) return

    const token = treeOpenTokenRef.current
    let tries = 0

    const pickMid = () => {
      if (branchDraft) return String((branchDraft as any)?.forkFromMid || '').trim()
      const chosen = String(treeFocusMid || '').trim()
      if (chosen) return chosen
      const head = String(activeBranchHeadMid || '').trim()
      if (head) return head
      const msgs: any[] = Array.isArray((activeChat as any)?.messages) ? ((activeChat as any).messages as any[]) : []
      return msgs.length ? String(msgs[msgs.length - 1]?.id || '').trim() : ''
    }

    const tryCenterOnce = () => {
      if (!treeOpen) return true
      if (token !== treeOpenTokenRef.current) return true
      const tr: any = treeRender
      if (!tr || !tr.byId || typeof tr.byId.get !== 'function') return false

      const mid = pickMid()
      if (!mid) return false
      const node = tr.byId.get(mid) || null
      if (!node) return false

      const host = (effectiveTreeView === 'float' ? treeHostFloatRef.current : treeHostRightRef.current) as HTMLDivElement | null
      if (!host) return false
      const w = Number(host.clientWidth || 0)
      const h = Number(host.clientHeight || 0)
      if (w < 20 || h < 20) return false

      stopTreeFollow()

      const nodeW = Number(tr.nodeW || 168)
      const nodeH = Number(tr.nodeH || 44)
      const wx = Number(node?.x || 0) + nodeW / 2
      const wy = Number(node?.y || 0) + nodeH / 2

      const v0 = treeViewRef.current
      const s = clampNum(Number(v0?.scale || 1), 0.35, 2.6)
      const cx = w / 2
      const cy = h / 2
      const targetX = cx - wx * s
      const targetY = cy - wy * s

      treeViewRef.current = { ...treeViewRef.current, x: targetX, y: targetY }
      setTreePan({ x: targetX, y: targetY })
      scheduleTreeViewTransform()

      if (!String(treeSelectedMid || treeFocusMid || '').trim()) setTreeSelectedMid(mid)
      treeNeedInitialCenterRef.current = false
      return true
    }

    const tick = () => {
      treeInitialCenterRafRef.current = 0
      if (!treeNeedInitialCenterRef.current) return
      tries++
      if (tries > 14) {
        treeNeedInitialCenterRef.current = false
        return
      }
      const ok = tryCenterOnce()
      if (ok) return
      treeInitialCenterRafRef.current = requestAnimationFrame(tick)
    }

    if (treeInitialCenterRafRef.current) cancelAnimationFrame(treeInitialCenterRafRef.current)
    treeInitialCenterRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (treeInitialCenterRafRef.current) cancelAnimationFrame(treeInitialCenterRafRef.current)
      treeInitialCenterRafRef.current = 0
    }
  }, [
    treeOpen,
    effectiveTreeView,
    treeRender,
    branchDraftKey,
    treeSelectedMid,
    treeFocusMid,
    String(activeChat?.id || ''),
    stopTreeFollow,
    scheduleTreeViewTransform,
  ])

  return {
    treeOpen,
    setTreeOpen,
    treeViewOverride,
    setTreeViewOverride,
    treePan,
    setTreePan,
    treeScale,
    setTreeScale,
    treeDir,
    setTreeDir,
    treeSelectedMid,
    setTreeSelectedMid,
    treePop,
    setTreePop,
    treeDragging,
    treeDragRef,
    treeViewportRef,
    treeViewRef,
    treeHostRightRef,
    treeHostFloatRef,
    treeFollowRafRef,
    treeFollowAnimRef,
    treeOpenTokenRef,
    treeNeedInitialCenterRef,
    effectiveTreeView,
    treePanelW,
    treeResizing,
    applyTreeViewTransform,
    scheduleTreeViewTransform,
    stopTreeFollow,
    endTreeResize,
    onTreeSplitterPointerDown,
    onTreeSplitterPointerMove,
    closeTreeModal,
    endTreeDrag,
    onTreePointerDown,
    onTreePointerMove,
    onTreeWheel,
    cycleTreeDir,
    treeRender,
    treeFocusMid,
    jumpToMessage,
  }
}
