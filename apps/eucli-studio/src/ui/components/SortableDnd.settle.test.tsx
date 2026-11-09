// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SortableItem, SortableRoot, SortableSection } from './SortableDnd'

// 松手后的位移冻结：用真实指针时序走一遍 dnd-kit 的排序，
// 锁住「数据落地前不弹回旧位置、落地后才归位」这条表现。
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const ROW = 40

function rowRect(index: number): DOMRect {
  const top = index * ROW
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    width: 200,
    height: ROW,
    right: 200,
    bottom: top + ROW,
    toJSON: () => ({}),
  } as DOMRect
}

/** happy-dom 没有布局，按行在父容器里的实际位置给出矩形。 */
function installRowRects(): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    const row = this.getAttribute?.('data-row')
    if (!row) return original.call(this)
    const parent = this.parentElement
    const index = parent ? Array.from(parent.children).indexOf(this) : 0
    return rowRect(index)
  }
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original
  }
}

function Rows(props: { items: string[]; onMove: (activeId: string, overId: string) => void }) {
  return (
    <SortableRoot onMove={props.onMove}>
      <SortableSection items={props.items}>
        {props.items.map((id) => (
          <SortableItem key={id} id={id}>
            {(args) => (
              <div
                ref={args.setNodeRef}
                data-row={id}
                {...args.handleProps}
                style={{ height: ROW, width: 200, ...args.style }}
              >
                {id}
              </div>
            )}
          </SortableItem>
        ))}
      </SortableSection>
    </SortableRoot>
  )
}

function rowTransform(host: HTMLElement, id: string): string {
  return (host.querySelector(`[data-row="${id}"]`) as HTMLElement).style.transform
}

function pointer(type: string, clientY: number, buttons: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    buttons,
    clientX: 100,
    clientY,
  })
}

function wait(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('松手后的位移冻结', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let restoreRowRects: () => void

  beforeEach(() => {
    restoreRowRects = installRowRects()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    restoreRowRects()
  })

  /** 用指针把 from 行往下拖到 to 行上，松手前不更新任何数据。 */
  async function drag(from: string, to: string) {
    const rows = Array.from(host.querySelectorAll('[data-row]'))
    const fromIndex = rows.findIndex((node) => node.getAttribute('data-row') === from)
    const toIndex = rows.findIndex((node) => node.getAttribute('data-row') === to)
    const source = rows[fromIndex] as HTMLElement
    const startY = fromIndex * ROW + 20
    const endY = toIndex * ROW + ROW / 2

    await act(async () => {
      source.dispatchEvent(pointer('pointerdown', startY, 1))
      // 第一次移动只越过激活阈值，第二次才产生实际位移。
      document.dispatchEvent(pointer('pointermove', startY + ROW / 2, 1))
      document.dispatchEvent(pointer('pointermove', endY, 1))
      await wait()
    })
  }

  async function release(clientY: number) {
    await act(async () => {
      document.dispatchEvent(pointer('pointerup', clientY, 0))
      await wait()
    })
  }

  it('松手后保持拖拽位移，条目顺序落地时才归位', async () => {
    const moves: string[][] = []
    let setItems: ((items: string[]) => void) | null = null

    function Harness() {
      const [items, set] = React.useState(['a', 'b', 'c'])
      setItems = set
      return <Rows items={items} onMove={(activeId, overId) => moves.push([activeId, overId])} />
    }

    await act(async () => {
      root.render(<Harness />)
      await wait()
    })

    await drag('b', 'c')
    const activeDuringDrag = rowTransform(host, 'b')
    const displacedDuringDrag = rowTransform(host, 'c')
    expect(activeDuringDrag).toBe('translate3d(0px, 40px, 0) scaleX(1) scaleY(1)')
    expect(displacedDuringDrag).toBe('translate3d(0px, -40px, 0) scaleX(1) scaleY(1)')

    await release(100)
    expect(moves).toEqual([['b', 'c']])
    // 数据还没回来：活动行与让位行都停在松手那一刻，不弹回旧位置。
    expect(rowTransform(host, 'b')).toBe(activeDuringDrag)
    expect(rowTransform(host, 'c')).toBe(displacedDuringDrag)

    // 数据落地：同一帧里 DOM 换成新顺序、位移归零，视觉直接落在新位置。
    await act(async () => {
      setItems?.(['a', 'c', 'b'])
      await wait()
    })
    expect(rowTransform(host, 'b')).toBe('')
    expect(rowTransform(host, 'c')).toBe('')
  })

  it('数据迟迟不落地时，冻结到上限后交还真实顺序', async () => {
    function Harness() {
      const [items] = React.useState(['a', 'b', 'c'])
      return <Rows items={items} onMove={() => {}} />
    }

    await act(async () => {
      root.render(<Harness />)
      await wait()
    })

    await drag('b', 'c')
    await release(100)
    expect(rowTransform(host, 'b')).not.toBe('')

    // 冻结上限是 600ms，留出余量等它释放。
    await act(async () => {
      await wait(750)
    })
    expect(rowTransform(host, 'b')).toBe('')
  })
})
