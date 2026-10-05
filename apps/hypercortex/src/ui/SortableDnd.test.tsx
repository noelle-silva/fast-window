// @vitest-environment jsdom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SortableDropSlot, SortableItem, SortableSideScope, type SortableItemRenderArgs } from './SortableDnd'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SortableDnd 非活动侧静态渲染', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('非活动侧的 SortableItem 不依赖拖拽上下文即可渲染（不订阅、不注册）', () => {
    let args: SortableItemRenderArgs | null = null
    act(() => {
      root.render(
        <SortableSideScope enabled={false}>
          <SortableItem id="row-1">
            {next => {
              args = next
              return <div>row</div>
            }}
          </SortableItem>
        </SortableSideScope>,
      )
    })
    expect(container.textContent).toContain('row')
    expect(args).not.toBeNull()
    expect(args!.isDragging).toBe(false)
    expect(args!.handleProps).toEqual({})
  })

  it('非活动侧的 SortableDropSlot 同样静态渲染', () => {
    let isOver: boolean | null = null
    act(() => {
      root.render(
        <SortableSideScope enabled={false}>
          <SortableDropSlot id="slot-1">
            {next => {
              isOver = next.isOver
              return <div>slot</div>
            }}
          </SortableDropSlot>
        </SortableSideScope>,
      )
    })
    expect(container.textContent).toContain('slot')
    expect(isOver).toBe(false)
  })
})
