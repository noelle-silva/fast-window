// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantMessageBlocks } from './AssistantMessageBlocks'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// 工具调用块标题行应显示「调用原因」：取工具入参里的 description。
// 该字段是框架惯例，并非每个工具都会传，所以无值时不渲染、不影响布局。
describe('工具调用块标题行显示调用描述', () => {
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

  function renderWithParts(parts: any[]) {
    const controller: any = {
      actions: {},
      renderAssistantInto: vi.fn(),
      getScopeVer: () => 0,
      subscribeScope: () => () => {},
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root.render(
        <AssistantMessageBlocks
          controller={controller}
          mid="m1"
          isGenerating={false}
          text=""
          parts={parts}
          reasoningDisplayMode="collapse-when-done"
          reasoningRenderEnabled={false}
          renderSafetyPolicyKey="original"
          chatRootRef={{ current: null }}
          disabled={false}
        />,
      )
    })
    return host
  }

  const DESCRIPTION = '提交开发管理仓库并清理临时补丁'

  it('入参带 description 时，标题行渲染该描述', () => {
    const el = renderWithParts([
      {
        id: 'p1',
        type: 'tool',
        callId: 'c1',
        toolName: 'shell_command',
        state: 'completed',
        input: { description: DESCRIPTION, command: 'echo hi' },
        result: { id: 'r1', status: 'success', content: 'ok', durationMs: 100 },
      },
    ])
    expect(el.textContent).toContain('shell_command')
    expect(el.textContent).toContain(DESCRIPTION)
  })

  it('入参没有 description 时，不渲染描述', () => {
    const el = renderWithParts([
      {
        id: 'p2',
        type: 'tool',
        callId: 'c2',
        toolName: 'file_reader',
        state: 'completed',
        input: { path: 'a.txt' },
        result: { id: 'r2', status: 'success', content: 'ok', durationMs: 100 },
      },
    ])
    expect(el.textContent).toContain('file_reader')
    expect(el.textContent).not.toContain(DESCRIPTION)
  })
})
