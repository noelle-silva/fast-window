import { useRef } from 'react'
import { Box } from '@mui/material'
import type { Plugin, PluginBrowseLayout } from './constants'
import { PluginCardContent, getCardDragSx, getCardPointerSurfaceSx, getCardSx } from './PluginCard'

const POINTER_ACTIVATION_MOVE_LIMIT_PX = 8

type PointerActivation = {
  pluginId: string
  pointerId: number
  x: number
  y: number
}

export interface PluginListViewProps {
  plugins: Plugin[]
  browseLayout: PluginBrowseLayout
  reorderMode: boolean
  draggingId: string | null
  dragOverId: string | null
  dragOverAfter: boolean
  onActivate: (plugin: Plugin) => void
  onContextMenu: (e: React.MouseEvent, plugin: Plugin) => void
  onPointerDown: (e: React.PointerEvent, pluginId: string) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
}

export default function PluginListView(props: PluginListViewProps) {
  const {
    plugins, browseLayout,
    reorderMode, draggingId, dragOverId, dragOverAfter,
    onActivate, onContextMenu, onPointerDown, onPointerMove, onPointerUp,
  } = props
  const pointerActivationRef = useRef<PointerActivation | null>(null)

  const beginPointerActivation = (e: React.PointerEvent, pluginId: string) => {
    if (e.button !== 0) return
    pointerActivationRef.current = {
      pluginId,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    }
  }

  const updatePointerActivation = (e: React.PointerEvent) => {
    const current = pointerActivationRef.current
    if (!current || current.pointerId !== e.pointerId) return
    const moved = Math.hypot(e.clientX - current.x, e.clientY - current.y)
    if (moved > POINTER_ACTIVATION_MOVE_LIMIT_PX) pointerActivationRef.current = null
  }

  const finishPointerActivation = (e: React.PointerEvent, plugin: Plugin) => {
    const current = pointerActivationRef.current
    pointerActivationRef.current = null
    if (!current || current.pointerId !== e.pointerId || current.pluginId !== plugin.id) return
    if (e.button !== 0) return
    onActivate(plugin)
  }

  const clearPointerActivation = () => {
    pointerActivationRef.current = null
  }

  const renderItem = (plugin: Plugin) => (
    <Box
      key={plugin.id}
      component="li"
      data-plugin-id={plugin.id}
      onContextMenu={e => onContextMenu(e, plugin)}
      onPointerDown={e => reorderMode ? onPointerDown(e, plugin.id) : beginPointerActivation(e, plugin.id)}
      onPointerMove={e => reorderMode ? onPointerMove(e) : updatePointerActivation(e)}
      onPointerUp={e => reorderMode ? onPointerUp() : finishPointerActivation(e, plugin)}
      onPointerCancel={() => reorderMode ? onPointerUp() : clearPointerActivation()}
      sx={[getCardSx(browseLayout), getCardPointerSurfaceSx(), getCardDragSx(draggingId, dragOverId, dragOverAfter, reorderMode, plugin.id)]}
    >
      <PluginCardContent plugin={plugin} layout={browseLayout} />
    </Box>
  )

  if (browseLayout === 'grid') {
    return (
      <Box component="ul" sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, p: 0.5, m: 0 }}>
        {plugins.map(renderItem)}
      </Box>
    )
  }

  if (browseLayout === 'icon') {
    return (
      <Box component="ul" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 1, p: 0.5, m: 0 }}>
        {plugins.map(renderItem)}
      </Box>
    )
  }

  return (
    <Box component="ul" sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: 0, m: 0 }}>
      {plugins.map(renderItem)}
    </Box>
  )
}
