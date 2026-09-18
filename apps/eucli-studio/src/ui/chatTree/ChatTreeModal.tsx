import * as React from 'react'
import { Box, Dialog, IconButton, Tooltip, Typography } from '@mui/material'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { TOPBAR_H } from '../appConstants'
import { colorMixVar } from '../colorThemeStyles'
import { ChatTreeNodeShape } from './ChatTreeNodeShape'
import { normalizeChatTreeNodeRole, svgSafeId } from './chatTreeLayout'

export function ChatTreeModal(props: {
  treeOpen: boolean
  effectiveTreeView: 'right' | 'float'
  treePanelW: number
  treeResizing: boolean
  transparentChatBg: boolean
  bgAlpha: number
  onTreeSplitterPointerDown: (e: React.PointerEvent) => void
  onTreeSplitterPointerMove: (e: React.PointerEvent) => void
  endTreeResize: (e: React.PointerEvent) => void
  setTreePan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  setTreeScale: React.Dispatch<React.SetStateAction<number>>
  treeViewRef: React.MutableRefObject<{ x: number; y: number; scale: number }>
  scheduleTreeViewTransform: () => void
  applyTreeViewTransform: () => void
  treeDir: 'lr' | 'tb' | 'bt' | 'rl'
  cycleTreeDir: () => void
  treeDragging: boolean
  onTreePointerDown: (e: React.PointerEvent) => void
  onTreePointerMove: (e: React.PointerEvent) => void
  endTreeDrag: (e: React.PointerEvent) => void
  onTreeWheel: (e: React.WheelEvent) => void
  treeHostRightRef: React.MutableRefObject<HTMLDivElement | null>
  treeHostFloatRef: React.MutableRefObject<HTMLDivElement | null>
  treeViewportRef: React.MutableRefObject<SVGGElement | null>
  treeSuppressClickRef: React.MutableRefObject<boolean>
  treeRender: any
  treeFocusMid: string
  treeHighlightEdgeKeys: Set<string>
  treePop: { id: string; at: number }
  setTreeSelectedMid: React.Dispatch<React.SetStateAction<string>>
  setTreePop: React.Dispatch<React.SetStateAction<{ id: string; at: number }>>
  jumpToMessage: (mid: string) => void
  onTreeNodeContextMenu: (e: any, mid: string, role: 'user' | 'assistant') => void
  closeTreeModal: (focusComposer: boolean) => void
}) {
  const {
    treeOpen,
    effectiveTreeView,
    treePanelW,
    treeResizing,
    transparentChatBg,
    bgAlpha,
    onTreeSplitterPointerDown,
    onTreeSplitterPointerMove,
    endTreeResize,
    setTreePan,
    setTreeScale,
    treeViewRef,
    scheduleTreeViewTransform,
    applyTreeViewTransform,
    treeDir,
    cycleTreeDir,
    treeDragging,
    onTreePointerDown,
    onTreePointerMove,
    endTreeDrag,
    onTreeWheel,
    treeHostRightRef,
    treeHostFloatRef,
    treeViewportRef,
    treeSuppressClickRef,
    treeRender,
    treeFocusMid,
    treeHighlightEdgeKeys,
    treePop,
    setTreeSelectedMid,
    setTreePop,
    jumpToMessage,
    onTreeNodeContextMenu,
    closeTreeModal,
  } = props

  return (
    <>
      <Box
        sx={{
          position: 'absolute',
          top: TOPBAR_H,
          right: 0,
          bottom: 0,
          width: treeOpen && effectiveTreeView === 'right' ? Math.round(treePanelW) : 0,
          transition: treeResizing ? 'none' : 'width 180ms ease',
          overflow: 'hidden',
          pointerEvents: treeOpen && effectiveTreeView === 'right' ? 'auto' : 'none',
          borderLeft: treeOpen && effectiveTreeView === 'right' ? '1px solid rgba(0,0,0,.10)' : '1px solid transparent',
          bgcolor: transparentChatBg ? colorMixVar('--studio-paper', Math.max(72, bgAlpha * 100)) : 'var(--studio-paper)',
          zIndex: 1000,
        }}
      >
        {treeOpen && effectiveTreeView === 'right' ? (
          <>
            <Box
              onPointerDown={onTreeSplitterPointerDown}
              onPointerMove={onTreeSplitterPointerMove}
              onPointerUp={endTreeResize}
              onPointerCancel={endTreeResize}
              sx={{
                position: 'absolute',
                left: -4,
                top: 0,
                bottom: 0,
                width: 8,
                zIndex: 4,
                cursor: 'col-resize',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                display: 'flex',
                alignItems: 'stretch',
                justifyContent: 'center',
                '& .fw-split-line': {
                  opacity: treeResizing ? 1 : 0,
                  bgcolor: treeResizing ? 'rgba(25,118,210,.55)' : 'rgba(0,0,0,.18)',
                  transition: 'opacity 120ms ease, background-color 120ms ease',
                },
                '&:hover .fw-split-line': { opacity: 1, bgcolor: 'rgba(25,118,210,.55)' },
              }}
            >
              <Box className="fw-split-line" sx={{ width: 1, bgcolor: 'rgba(0,0,0,.18)' }} />
            </Box>
            <Box sx={{ position: 'relative', width: '100%', height: '100%', userSelect: 'none', WebkitUserSelect: 'none' }}>
              <Tooltip title="重置视图">
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      setTreePan({ x: 18, y: 18 })
                      setTreeScale(1)
                      treeViewRef.current = { x: 18, y: 18, scale: 1 }
                      scheduleTreeViewTransform()
                      try {
                        ;(e.currentTarget as any)?.blur?.()
                      } catch (_) {}
                    }}
                    disabled={!treeOpen}
                    sx={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      zIndex: 2,
                      bgcolor: 'rgba(255,255,255,.72)',
                      border: '1px solid rgba(0,0,0,.12)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      '&:hover': { bgcolor: 'rgba(255,255,255,.82)' },
                    }}
                  >
                    <RestartAltIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip
                title={
                  treeDir === 'lr'
                    ? '切换方向（当前：左→右）'
                    : treeDir === 'rl'
                      ? '切换方向（当前：右→左）'
                      : treeDir === 'tb'
                        ? '切换方向（当前：上→下）'
                        : '切换方向（当前：下→上）'
                }
              >
                <span>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      cycleTreeDir()
                      try {
                        ;(e.currentTarget as any)?.blur?.()
                      } catch (_) {}
                    }}
                    disabled={!treeOpen}
                    sx={{
                      position: 'absolute',
                      top: 10,
                      right: 52,
                      zIndex: 2,
                      bgcolor: 'rgba(255,255,255,.72)',
                      border: '1px solid rgba(0,0,0,.12)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      '&:hover': { bgcolor: 'rgba(255,255,255,.82)' },
                    }}
                  >
                    <AutorenewIcon fontSize="inherit" />
                  </IconButton>
                </span>
              </Tooltip>

              <Box
                onPointerDown={onTreePointerDown}
                onPointerMove={onTreePointerMove}
                onPointerUp={endTreeDrag}
                onPointerCancel={endTreeDrag}
                onWheel={onTreeWheel}
                ref={(el: any) => {
                  treeHostRightRef.current = el
                }}
                sx={{
                  position: 'absolute',
                  inset: 0,
                  bgcolor: 'rgba(0,0,0,.03)',
                  overflow: 'hidden',
                  cursor: treeDragging ? 'grabbing' : 'grab',
                  touchAction: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                }}
              >
                {treeRender && Array.isArray((treeRender as any).nodes) && (treeRender as any).nodes.length ? (
                  <svg width="100%" height="100%" style={{ display: 'block' }}>
                    <g
                      ref={(el) => {
                        treeViewportRef.current = el
                        if (el) requestAnimationFrame(() => applyTreeViewTransform())
                      }}
                      transform="translate(0,0) scale(1)"
                    >
                      {Array.isArray((treeRender as any).edges)
                        ? ((treeRender as any).edges as any[]).map((e: any) => {
                            const from = String(e?.from || '').trim()
                            const to = String(e?.to || '').trim()
                            if (!from || !to) return null
                            const a = (treeRender as any)?.byId?.get(from) || null
                            const b = (treeRender as any)?.byId?.get(to) || null
                            if (!a || !b) return null
                            const w = Number((treeRender as any).nodeW || 168)
                            const h = Number((treeRender as any).nodeH || 44)
                            const strokeW = 6
                            const capR = strokeW / 2
                            const aiGap = 2
                            const selectedMid = String(treeFocusMid || '')

                            const ax = Number(a.x || 0)
                            const ay = Number(a.y || 0)
                            const bx = Number(b.x || 0)
                            const by = Number(b.y || 0)
                            const aIsAi = String(a?.role || '') === 'assistant'
                            const bIsAi = String(b?.role || '') === 'assistant'
                            const aDotR = aIsAi && from === selectedMid ? 10 : 8
                            const bDotR = bIsAi && to === selectedMid ? 10 : 8
                            const aOff = aIsAi ? aDotR + capR + aiGap : 0
                            const bOff = bIsAi ? bDotR + capR + aiGap : 0

                            const horizontal = treeDir === 'lr' || treeDir === 'rl'
                            let sx = 0
                            let sy = 0
                            let tx = 0
                            let ty = 0
                            let d = ''

                            if (horizontal) {
                              const forward = bx >= ax
                              const acx = ax + w / 2
                              const acy = ay + h / 2
                              const bcx = bx + w / 2
                              const bcy = by + h / 2

                              sx = aIsAi ? acx + (forward ? aOff : -aOff) : ax + (forward ? w : 0)
                              sy = aIsAi ? acy : ay + h / 2
                              tx = bIsAi ? bcx + (forward ? -bOff : bOff) : bx + (forward ? 0 : w)
                              ty = bIsAi ? bcy : by + h / 2
                              const dd = Math.max(42, Math.abs(tx - sx) * 0.5)
                              d = `M ${sx} ${sy} C ${sx + (forward ? dd : -dd)} ${sy} ${tx - (forward ? dd : -dd)} ${ty} ${tx} ${ty}`
                            } else {
                              const forward = by >= ay
                              const acx = ax + w / 2
                              const acy = ay + h / 2
                              const bcx = bx + w / 2
                              const bcy = by + h / 2

                              sx = aIsAi ? acx : ax + w / 2
                              sy = aIsAi ? acy + (forward ? aOff : -aOff) : ay + (forward ? h : 0)
                              tx = bIsAi ? bcx : bx + w / 2
                              ty = bIsAi ? bcy + (forward ? -bOff : bOff) : by + (forward ? 0 : h)
                              const dd = Math.max(42, Math.abs(ty - sy) * 0.5)
                              d = `M ${sx} ${sy} C ${sx} ${sy + (forward ? dd : -dd)} ${tx} ${ty - (forward ? dd : -dd)} ${tx} ${ty}`
                            }
                            const key = `${from}->${to}`
                            const hi = treeHighlightEdgeKeys.has(key)
                            return (
                              <path
                                key={key}
                                d={d}
                                fill="none"
                                stroke={hi ? 'rgba(34,197,94,.85)' : 'rgba(0,0,0,.16)'}
                                strokeWidth={strokeW}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            )
                          })
                        : null}

                      {((treeRender as any).nodes as any[]).map((n: any) => {
                        const id = String(n?.id || '').trim()
                        if (!id) return null
                        const x = Number(n?.x || 0)
                        const y = Number(n?.y || 0)
                        const w = Number((treeRender as any).nodeW || 168)
                        const h = Number((treeRender as any).nodeH || 44)
                        const role = normalizeChatTreeNodeRole(n?.role)
                        const text = String(n?.text || '')
                        const isSelected = id === String(treeFocusMid || '')
                        const clipId = `fw-tree-clip-${svgSafeId(id)}`

                        return (
                          <g key={id} transform={`translate(${Math.round(x)},${Math.round(y)})`}>
                            <g
                              className="fw-tree-node"
                              data-pop={treePop.id === id ? '1' : undefined}
                              style={{ cursor: 'pointer' }}
                              data-tree-node="1"
                              onClick={(ev) => {
                                if (treeSuppressClickRef.current) {
                                  treeSuppressClickRef.current = false
                                  ev.preventDefault()
                                  ev.stopPropagation()
                                  return
                                }
                                setTreeSelectedMid(id)
                                setTreePop({ id, at: Date.now() })
                                jumpToMessage(id)
                              }}
                              onContextMenu={role === 'system' ? undefined : (ev) => onTreeNodeContextMenu(ev, id, role === 'assistant' ? 'assistant' : 'user')}
                              onPointerDown={(ev) => {
                                ev.stopPropagation()
                              }}
                            >
                              <ChatTreeNodeShape role={role} text={text} isSelected={isSelected} w={w} h={h} clipId={clipId} />
                            </g>
                          </g>
                        )
                      })}
                    </g>
                  </svg>
                ) : (
                  <Box sx={{ p: 1.5 }}>
                    <Typography variant="body2" color="text.secondary">
                      暂无可展示的树（至少需要 1 条消息）。
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </>
        ) : null}
      </Box>

      <Dialog
        open={treeOpen && effectiveTreeView === 'float'}
        onClose={() => closeTreeModal(true)}
        maxWidth={false}
        disableRestoreFocus
        PaperProps={{
          sx: {
            width: 'min(92vw, 980px)',
            height: 'min(80vh, 760px)',
            borderRadius: 3,
            overflow: 'hidden',
            bgcolor: transparentChatBg ? colorMixVar('--studio-paper', Math.max(72, bgAlpha * 100)) : 'var(--studio-paper)',
          },
        }}
      >
        <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
          <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 3, display: 'flex', gap: 1 }}>
            <Tooltip
              title={
                treeDir === 'lr'
                  ? '切换方向（当前：左→右）'
                  : treeDir === 'rl'
                    ? '切换方向（当前：右→左）'
                    : treeDir === 'tb'
                      ? '切换方向（当前：上→下）'
                      : '切换方向（当前：下→上）'
              }
            >
              <span>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    cycleTreeDir()
                    try {
                      ;(e.currentTarget as any)?.blur?.()
                    } catch (_) {}
                  }}
                  sx={{
                    bgcolor: 'rgba(255,255,255,.72)',
                    border: '1px solid rgba(0,0,0,.12)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    '&:hover': { bgcolor: 'rgba(255,255,255,.82)' },
                  }}
                >
                  <AutorenewIcon fontSize="inherit" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="重置视图">
              <span>
                <IconButton
                  size="small"
                  onClick={() => {
                    setTreePan({ x: 18, y: 18 })
                    setTreeScale(1)
                    treeViewRef.current = { x: 18, y: 18, scale: 1 }
                    scheduleTreeViewTransform()
                  }}
                  onMouseUp={(e) => {
                    try {
                      ;(e.currentTarget as any)?.blur?.()
                    } catch (_) {}
                  }}
                  sx={{
                    bgcolor: 'rgba(255,255,255,.72)',
                    border: '1px solid rgba(0,0,0,.12)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    '&:hover': { bgcolor: 'rgba(255,255,255,.82)' },
                  }}
                >
                  <RestartAltIcon fontSize="inherit" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          <Box
            onPointerDown={onTreePointerDown}
            onPointerMove={onTreePointerMove}
            onPointerUp={endTreeDrag}
            onPointerCancel={endTreeDrag}
            onWheel={onTreeWheel}
            ref={(el: any) => {
              treeHostFloatRef.current = el
            }}
            sx={{
              position: 'absolute',
              inset: 0,
              bgcolor: 'rgba(0,0,0,.03)',
              overflow: 'hidden',
              cursor: treeDragging ? 'grabbing' : 'grab',
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              contain: 'strict',
            }}
          >
            {treeRender && Array.isArray((treeRender as any).nodes) && (treeRender as any).nodes.length ? (
              <svg width="100%" height="100%" style={{ display: 'block' }}>
                <g
                  ref={(el) => {
                    treeViewportRef.current = el
                    if (el) requestAnimationFrame(() => applyTreeViewTransform())
                  }}
                  transform="translate(0,0) scale(1)"
                >
                  {Array.isArray((treeRender as any).edges)
                    ? ((treeRender as any).edges as any[]).map((e: any) => {
                        const from = String(e?.from || '').trim()
                        const to = String(e?.to || '').trim()
                        if (!from || !to) return null
                        const a = (treeRender as any)?.byId?.get(from) || null
                        const b = (treeRender as any)?.byId?.get(to) || null
                        if (!a || !b) return null
                        const w = Number((treeRender as any).nodeW || 168)
                        const h = Number((treeRender as any).nodeH || 44)
                        const strokeW = 6
                        const capR = strokeW / 2
                        const aiGap = 2
                        const selectedMid = String(treeFocusMid || '')
                        const ax = Number(a.x || 0)
                        const ay = Number(a.y || 0)
                        const bx = Number(b.x || 0)
                        const by = Number(b.y || 0)
                        const aIsAi = String(a?.role || '') === 'assistant'
                        const bIsAi = String(b?.role || '') === 'assistant'
                        const aDotR = aIsAi && from === selectedMid ? 10 : 8
                        const bDotR = bIsAi && to === selectedMid ? 10 : 8
                        const aOff = aIsAi ? aDotR + capR + aiGap : 0
                        const bOff = bIsAi ? bDotR + capR + aiGap : 0

                        const horizontal = treeDir === 'lr' || treeDir === 'rl'
                        let sx = 0
                        let sy = 0
                        let tx = 0
                        let ty = 0
                        let d = ''

                        if (horizontal) {
                          const forward = bx >= ax
                          const acx = ax + w / 2
                          const acy = ay + h / 2
                          const bcx = bx + w / 2
                          const bcy = by + h / 2

                          sx = aIsAi ? acx + (forward ? aOff : -aOff) : ax + (forward ? w : 0)
                          sy = aIsAi ? acy : ay + h / 2
                          tx = bIsAi ? bcx + (forward ? -bOff : bOff) : bx + (forward ? 0 : w)
                          ty = bIsAi ? bcy : by + h / 2
                          const dd = Math.max(42, Math.abs(tx - sx) * 0.5)
                          d = `M ${sx} ${sy} C ${sx + (forward ? dd : -dd)} ${sy} ${tx - (forward ? dd : -dd)} ${ty} ${tx} ${ty}`
                        } else {
                          const forward = by >= ay
                          const acx = ax + w / 2
                          const acy = ay + h / 2
                          const bcx = bx + w / 2
                          const bcy = by + h / 2

                          sx = aIsAi ? acx : ax + w / 2
                          sy = aIsAi ? acy + (forward ? aOff : -aOff) : ay + (forward ? h : 0)
                          tx = bIsAi ? bcx : bx + w / 2
                          ty = bIsAi ? bcy + (forward ? -bOff : bOff) : by + (forward ? 0 : h)
                          const dd = Math.max(42, Math.abs(ty - sy) * 0.5)
                          d = `M ${sx} ${sy} C ${sx} ${sy + (forward ? dd : -dd)} ${tx} ${ty - (forward ? dd : -dd)} ${tx} ${ty}`
                        }
                        const key = `${from}->${to}`
                        const hi = treeHighlightEdgeKeys.has(key)
                        return (
                          <path
                            key={key}
                            d={d}
                            fill="none"
                            stroke={hi ? 'rgba(34,197,94,.85)' : 'rgba(0,0,0,.16)'}
                            strokeWidth={strokeW}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )
                      })
                    : null}

                  {((treeRender as any).nodes as any[]).map((n: any) => {
                    const id = String(n?.id || '').trim()
                    if (!id) return null
                    const x = Number(n?.x || 0)
                    const y = Number(n?.y || 0)
                    const w = Number((treeRender as any).nodeW || 168)
                    const h = Number((treeRender as any).nodeH || 44)
                    const role = normalizeChatTreeNodeRole(n?.role)
                    const text = String(n?.text || '')
                    const isSelected = id === String(treeFocusMid || '')
                    const clipId = `fw-tree-clip-${svgSafeId(id)}`

                    return (
                      <g key={id} transform={`translate(${Math.round(x)},${Math.round(y)})`}>
                        <g
                          className="fw-tree-node"
                          data-pop={treePop.id === id ? '1' : undefined}
                          style={{ cursor: 'pointer' }}
                          data-tree-node="1"
                          onClick={(ev) => {
                            if (treeSuppressClickRef.current) {
                              treeSuppressClickRef.current = false
                              ev.preventDefault()
                              ev.stopPropagation()
                              return
                            }
                            setTreeSelectedMid(id)
                            setTreePop({ id, at: Date.now() })
                            jumpToMessage(id)
                          }}
                          onContextMenu={role === 'system' ? undefined : (ev) => onTreeNodeContextMenu(ev, id, role === 'assistant' ? 'assistant' : 'user')}
                          onPointerDown={(ev) => {
                            ev.stopPropagation()
                          }}
                        >
                          <ChatTreeNodeShape role={role} text={text} isSelected={isSelected} w={w} h={h} clipId={clipId} />
                        </g>
                      </g>
                    )
                  })}
                </g>
              </svg>
            ) : (
              <Box sx={{ p: 1.5 }}>
                <Typography variant="body2" color="text.secondary">
                  暂无可展示的树（至少需要 1 条消息）。
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Dialog>
    </>
  )
}
