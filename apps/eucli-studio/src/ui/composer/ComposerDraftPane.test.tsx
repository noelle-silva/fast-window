// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { COMPOSER_REFRESH_SCOPE } from '../../domain/uiRefreshScope'
import { ComposerDraftPane } from './ComposerDraftPane'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 极简 composer 控制器：草稿只有 input，逐键写入不广播，外部写入广播。
function createHarness(initial: string) {
  let input = initial
  let version = 0
  const listeners = new Set<() => void>()
  const emit = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }
  const controller = {
    getScopeVer: (scope: string) => (scope === COMPOSER_REFRESH_SCOPE ? version : 0),
    subscribeScope: (scope: string, listener: () => void) => {
      if (scope !== COMPOSER_REFRESH_SCOPE) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getComposerDraft: () => ({ input, images: [] }),
    actions: {
      setComposerInput: (next: string) => {
        input = String(next || '')
      },
    },
  }
  return {
    controller,
    current: () => input,
    writeExternal: (next: string) => {
      input = next
      emit()
    },
  }
}

describe('提示词库右栏：当前输入框', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  function textarea() {
    return host?.querySelector('textarea') as HTMLTextAreaElement | null
  }

  function type(value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    act(() => {
      const el = textarea()
      expect(el).toBeTruthy()
      setter?.call(el, value)
      el?.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('打开时显示输入框里已有的那段文字', () => {
    const harness = createHarness('已经写好的一段话')
    act(() => {
      root.render(<ComposerDraftPane controller={harness.controller} draftKey="chat-1" />)
    })
    expect(textarea()?.value).toBe('已经写好的一段话')
  })

  it('在这里打字直接写进输入框草稿', () => {
    const harness = createHarness('')
    act(() => {
      root.render(<ComposerDraftPane controller={harness.controller} draftKey="chat-1" />)
    })
    type('从这里改的内容')
    expect(textarea()?.value).toBe('从这里改的内容')
    expect(harness.current()).toBe('从这里改的内容')
  })

  it('输入框那边改了（发完清空、切会话）这里跟着变', () => {
    const harness = createHarness('原内容')
    act(() => {
      root.render(<ComposerDraftPane controller={harness.controller} draftKey="chat-1" />)
    })
    expect(textarea()?.value).toBe('原内容')

    act(() => {
      harness.writeExternal('')
    })
    expect(textarea()?.value).toBe('')
  })
})
