import * as React from 'react'
import { SortableItem, SortableRoot, SortableSection, type SortableItemRenderArgs } from './SortableDnd'
import { useSortableClickGuard } from './useSortableClickGuard'

export type SortableListRenderArgs = {
  id: string
  index: number
  drag: SortableItemRenderArgs
  shouldIgnoreClick: () => boolean
}

export function SortableList(props: {
  ids: string[]
  onMove: (activeId: string, overId: string) => void
  disabled?: boolean
  children: (args: SortableListRenderArgs) => React.ReactNode
}) {
  const { ids, onMove, disabled = false, children } = props
  const clickGuard = useSortableClickGuard()
  return (
    <SortableRoot onMove={onMove} onDragStart={clickGuard.onDragStart} onDragStop={clickGuard.onDragStop}>
      <SortableSection items={ids}>
        {ids.map((id, index) => (
          <SortableItem key={id} id={id} disabled={disabled}>
            {(drag) => children({ id, index, drag, shouldIgnoreClick: clickGuard.shouldIgnoreClick })}
          </SortableItem>
        ))}
      </SortableSection>
    </SortableRoot>
  )
}
