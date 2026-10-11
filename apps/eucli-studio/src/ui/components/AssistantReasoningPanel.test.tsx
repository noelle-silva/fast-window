// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantReasoningPanel } from './AssistantReasoningPanel'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function click(el: Element | null) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function typeInto(el: HTMLTextAreaElement | HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
  act(() => {
    setter?.call(el, value)
    el?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// 思维链块的清洗按钮：点开关键词输入弹窗，确认后把关键词交给清洗动作。
describe('AssistantReasoningPanel 清洗思维链', () => {
  let host: HTMLDivElement | null = null
  let root: any = null

  afterEach(() => {
    if (root) {
      act(() => root.unmount())
      root = null
    }
    host?.remove()
    host = null
  })

  function renderPanel(cleanMessageReasoning: any) {
    const controller: any = { actions: { cleanMessageReasoning } }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root.render(
        <AssistantReasoningPanel
          controller={controller}
          mid="m1"
          isActive={false}
          displayMode="stay-expanded"
          renderMarkdown={false}
          text="思考内容"
          durationMs={0}
          renderSafetyPolicyKey="original"
          chatRootRef={{ current: null }}
        />,
      )
    })
    return host
  }

  it('确认后按消息 id 调用清洗动作', async () => {
    const cleanMessageReasoning = vi.fn(async () => true)
    const el = renderPanel(cleanMessageReasoning)

    click(el.querySelector('button[aria-label="清洗思维链"]'))
    const input = document.querySelector('textarea') as HTMLTextAreaElement | null
    expect(input).toBeTruthy()
    typeInto(input, '甲\n乙')

    const buttons = Array.from(document.querySelectorAll('button'))
    const confirm = buttons.find((b) => b.textContent?.trim() === '清洗') || null
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(cleanMessageReasoning).toHaveBeenCalledWith('m1', '甲\n乙')
  })
})
