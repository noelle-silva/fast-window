import { Box, List, ListItemButton } from '@mui/material'
import type { Plugin, PluginBrowseLayout } from './constants'
import { PluginCardContent, getCardDragStyles, getCardSx } from './PluginCard'

export interface PluginListViewProps {
  plugins: Plugin[]
  activeIndex: number
  activePlugin: Plugin | null
  browseLayout: PluginBrowseLayout
  reorderMode: boolean
  draggingId: string | null
  dragOverId: string | null
  dragOverAfter: boolean
  onSelect: (plugin: Plugin, index: number) => void
  onContextMenu: (e: React.MouseEvent, plugin: Plugin) => void
  onPointerDown: (e: React.PointerEvent, pluginId: string) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
}

export default function PluginListView(props: PluginListViewProps) {
  const {
    plugins, activeIndex, browseLayout,
    reorderMode, draggingId, dragOverId, dragOverAfter,
    onSelect, onContextMenu, onPointerDown, onPointerMove, onPointerUp,
  } = props

  if (browseLayout === 'grid') {
    return (
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, p: 0.5 }}>
        {plugins.map((plugin, index) => (
          <ListItemButton
            key={plugin.id}
            data-plugin-id={plugin.id}
            selected={index === activeIndex}
            onContextMenu={e => onContextMenu(e, plugin)}
            onPointerDown={reorderMode ? (e => onPointerDown(e, plugin.id)) : undefined}
            onPointerMove={reorderMode ? onPointerMove : undefined}
            onPointerUp={reorderMode ? onPointerUp : undefined}
            onPointerCancel={reorderMode ? onPointerUp : undefined}
            onClick={() => onSelect(plugin, index)}
            sx={getCardSx('grid')}
            style={getCardDragStyles(draggingId, dragOverId, dragOverAfter, reorderMode, plugin.id) as any}
          >
            <PluginCardContent plugin={plugin} layout="grid" />
          </ListItemButton>
        ))}
      </Box>
    )
  }

  if (browseLayout === 'icon') {
    return (
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 1, p: 0.5 }}>
        {plugins.map((plugin, index) => (
          <ListItemButton
            key={plugin.id}
            data-plugin-id={plugin.id}
            selected={index === activeIndex}
            onContextMenu={e => onContextMenu(e, plugin)}
            onPointerDown={reorderMode ? (e => onPointerDown(e, plugin.id)) : undefined}
            onPointerMove={reorderMode ? onPointerMove : undefined}
            onPointerUp={reorderMode ? onPointerUp : undefined}
            onPointerCancel={reorderMode ? onPointerUp : undefined}
            onClick={() => onSelect(plugin, index)}
            sx={getCardSx('icon')}
            style={getCardDragStyles(draggingId, dragOverId, dragOverAfter, reorderMode, plugin.id) as any}
          >
            <PluginCardContent plugin={plugin} layout="icon" />
          </ListItemButton>
        ))}
      </Box>
    )
  }

  return (
    <List disablePadding sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {plugins.map((plugin, index) => (
        <ListItemButton
          key={plugin.id}
          data-plugin-id={plugin.id}
          selected={index === activeIndex}
          onContextMenu={e => onContextMenu(e, plugin)}
          onPointerDown={reorderMode ? (e => onPointerDown(e, plugin.id)) : undefined}
          onPointerMove={reorderMode ? onPointerMove : undefined}
          onPointerUp={reorderMode ? onPointerUp : undefined}
          onPointerCancel={reorderMode ? onPointerUp : undefined}
          onClick={() => onSelect(plugin, index)}
          sx={getCardSx('list')}
          style={getCardDragStyles(draggingId, dragOverId, dragOverAfter, reorderMode, plugin.id) as any}
        >
          <PluginCardContent plugin={plugin} layout="list" />
        </ListItemButton>
      ))}
    </List>
  )
}
