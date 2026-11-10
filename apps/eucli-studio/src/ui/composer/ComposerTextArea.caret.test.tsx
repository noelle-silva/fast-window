// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ComposerTextArea, type ComposerTextAreaInsertApi } from './ComposerTextArea'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 受控外壳：插入走 onChange，落值后再渲染回输入框，跟真实用法一致。
function Harness(props: {
  initial: string
  inputRef: React.MutableRefObject<HTMLTextAreaElement | HTMLInputElement | null>
  onApi: (api: ComposerTextAreaInsertApi | null) => void
}) {
  const [value, setValue] = React.useState(props.initial)
  return (
    <ComposerTextArea
      value={value}
      onChange={setValue}
      inputRef={props.inputRef}
      disabled={false}
      activeTargetKind="role"
      activeGroup={null}
      roles={[]}
      formatModelRefText={() => ''}
      minRows={3}
      radius={8}
      insertApi={props.onApi}
    />
  )
}

describe('输入件的「在光标处插入」', () => {
  let host: HTMLDivElement | null = null
  let root: any = null
  let api: ComposerTextAreaInsertApi | null = null
  const inputRef: React.MutableRefObject<HTMLTextAreaElement | HTMLInputElement | null> = { current: null }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    api = null
    inputRef.current = null
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  function renderArea(initial: string) {
    act(() => {
      root.render(<Harness initial={initial} inputRef={inputRef} onApi={(next) => (api = next)} />)
    })
    const el = host?.querySelector('textarea') as HTMLTextAreaElement | null
    expect(el).toBeTruthy()
    expect(api).toBeTruthy()
    return el as HTMLTextAreaElement
  }

  function insert(text: string) {
    act(() => {
      api?.insertAtCaret(text)
    })
  }

  it('光标在输入框里：插在光标处', () => {
    const el = renderArea('abcdef')
    act(() => {
      el.focus()
      el.setSelectionRange(3, 3)
    })
    insert('[X]')
    expect(el.value).toBe('abc[X]def')
    expect(document.activeElement).toBe(el)
  })

  it('有选中片段：替换选中的那一段', () => {
    const el = renderArea('abcdef')
    act(() => {
      el.focus()
      el.setSelectionRange(1, 4)
    })
    insert('X')
    expect(el.value).toBe('aXef')
  })

  it('光标已经离开输入框：补到末尾', () => {
    const el = renderArea('abcdef')
    act(() => {
      el.blur()
    })
    insert('X')
    expect(el.value).toBe('abcdefX')
  })

  it('连着插两条接着往后排，不会都挤在同一处', async () => {
    const el = renderArea('abcdef')
    act(() => {
      el.focus()
      el.setSelectionRange(2, 2)
    })
    insert('1')
    // 等一帧：插入后光标是在下一次绘制里才落回去的。
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    insert('2')
    expect(el.value).toBe('ab12cdef')
  })
})
