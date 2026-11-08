import * as React from 'react'
import {
  SortableItem,
  SortableRoot,
  SortableSection,
  type SortableItemRenderArgs,
} from './SortableDnd'

export type SortableListRenderArgs = {
  id: string
  index: number
  drag: SortableItemRenderArgs
  /** 拖拽刚结束时忽略这一行的点击，避免「拖完顺手触发打开」。 */
  shouldIgnoreClick: () => boolean
}

export function SortableList(props: {
  ids: string[]
  onMove: (activeId: string, overId: string) => void
  disabled?: boolean
  children: (args: SortableListRenderArgs) => React.ReactNode
}) {
  const { ids, onMove, disabled = false, children } = props
  return (
    <SortableRoot onMove={onMove}>
      <SortableSection items={ids}>
        {ids.map((id, index) => (
          <SortableItem key={id} id={id} disabled={disabled}>
            {(drag) => children({ id, index, drag, shouldIgnoreClick: drag.shouldSuppressClick })}
          </SortableItem>
        ))}
      </SortableSection>
    </SortableRoot>
  )
}
