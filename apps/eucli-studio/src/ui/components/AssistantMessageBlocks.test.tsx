// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantMessageBlocks } from './AssistantMessageBlocks'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

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

function renderWithParts(parts: any[], isGenerating = false) {
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
        isGenerating={isGenerating}
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

// 工具调用块标题行应显示「调用原因」：取工具入参里的 description。
// 该字段是框架惯例，并非每个工具都会传，所以无值时不渲染、不影响布局。
describe('工具调用块标题行显示调用描述', () => {
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

// 工具块左侧状态圆：成功打勾、失败打叉、等待确认暂停、运行中中性点。
describe('工具调用状态圆', () => {
  function renderTool(part: any) {
    return renderWithParts([{ id: 'p1', type: 'tool', callId: 'c1', toolName: 'shell_command', input: {}, ...part }])
  }

  function phaseOf(el: HTMLElement) {
    const dot = el.querySelector('[data-tool-phase]')
    return {
      phase: dot?.getAttribute('data-tool-phase'),
      label: dot?.getAttribute('aria-label'),
    }
  }

  it('结果成功时圆为成功相位', () => {
    const el = renderTool({ state: 'completed', result: { id: 'r1', status: 'success', content: 'ok' } })
    expect(phaseOf(el)).toEqual({ phase: 'success', label: '工具调用成功' })
  })

  it('结果失败时圆为失败相位', () => {
    const el = renderTool({ state: 'completed', result: { id: 'r1', status: 'failed', error: 'boom' } })
    expect(phaseOf(el)).toEqual({ phase: 'error', label: '工具调用失败' })
  })

  it('等待确认时圆为暂停相位', () => {
    const el = renderTool({ state: 'needs_confirmation' })
    expect(phaseOf(el)).toEqual({ phase: 'pending', label: '工具调用等待确认' })
  })

  it('运行中没有结果时为中性相位', () => {
    const el = renderTool({ state: 'running' })
    expect(phaseOf(el)).toEqual({ phase: 'running', label: '工具调用进行中' })
  })
})

// 工具子块的头部：标题、块操作与 callid 同处一层，不再另起一条标题行。
describe('工具块头部结构', () => {
  function click(el: Element | null) {
    act(() => {
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('块操作与状态在头部，工具名与 callid 同一行', () => {
    const el = renderWithParts([
      {
        id: 'p1',
        type: 'tool',
        callId: 'call-9',
        toolName: 'shell_command',
        state: 'completed',
        input: { description: '跑一下' },
        result: { id: 'r1', status: 'success', content: 'ok' },
      },
    ])

    click(el.querySelector('[aria-label="展开工具会话"]'))
    const header = el.querySelector('.fw-tool-header')
    expect(header).toBeTruthy()
    expect(header?.querySelector('button[aria-label="复制消息块"]')).toBeTruthy()
    expect(header?.querySelector('button[aria-label="编辑消息块"]')).toBeTruthy()
    expect(header?.querySelector('button[aria-label="删除消息块"]')).toBeTruthy()
    // 左侧小方块移除，状态文字落在标题右侧。
    expect(header?.querySelector('.fw-tool-glyph')).toBeNull()
    const title = header?.querySelector('.fw-tool-title')
    expect(title?.textContent).toContain('工具调用')
    expect(title?.textContent).toContain('成功')
    // 工具名与 callid 并排在同一行。
    const meta = el.querySelector('[data-tool-meta]')
    expect(meta?.textContent).toContain('shell_command')
    expect(meta?.textContent).toContain('call-9')
  })

  it('正文不再显示输入参数与返回内容标签', () => {
    const el = renderWithParts([
      {
        id: 'p1',
        type: 'tool',
        callId: 'call-9',
        toolName: 'shell_command',
        state: 'completed',
        input: { description: '跑一下' },
        result: { id: 'r1', status: 'success', content: 'ok' },
      },
    ])

    click(el.querySelector('[aria-label="展开工具会话"]'))
    expect(el.textContent).not.toContain('输入参数')
    expect(el.textContent).not.toContain('返回内容')
  })

  it('工具调用与工具返回各自只有一个头部，没有外层重复标题', () => {
    const el = renderWithParts([
      {
        id: 'p1',
        type: 'tool',
        callId: 'call-9',
        toolName: 'shell_command',
        state: 'completed',
        input: {},
        result: { id: 'r1', status: 'success', content: 'ok' },
      },
    ])

    click(el.querySelector('[aria-label="展开工具会话"]'))
    expect(el.querySelectorAll('.fw-tool-header').length).toBe(2)
    expect(el.querySelectorAll('.fw-tool-title').length).toBe(2)
  })
})

// 输入参数按字段渲染；字段本身全部列出，只有超长的值单独折叠。
describe('工具输入参数字段表', () => {
  function click(el: Element | null) {
    act(() => {
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  const LONG_COMMAND = `pnpm vitest run ${'x'.repeat(160)}`

  function renderInvocation(input: any) {
    const el = renderWithParts([
      {
        id: 'p1',
        type: 'tool',
        callId: 'call-9',
        toolName: 'shell_command',
        state: 'completed',
        input,
        result: { id: 'r1', status: 'success', content: 'ok' },
      },
    ])
    click(el.querySelector('[aria-label="展开工具会话"]'))
    return el
  }

  it('字段全部列出，只有长值带展开入口', () => {
    const el = renderInvocation({ command: LONG_COMMAND, description: '短值' })
    expect(el.querySelectorAll('[data-tool-field]').length).toBe(2)
    expect(el.querySelector('button[aria-label="展开字段 command"]')).toBeTruthy()
    expect(el.querySelector('button[aria-label="展开字段 description"]')).toBeNull()
  })

  it('长值可以单独展开与收起', () => {
    const el = renderInvocation({ command: LONG_COMMAND })
    click(el.querySelector('button[aria-label="展开字段 command"]'))
    expect(el.querySelector('button[aria-label="收起字段 command"]')).toBeTruthy()
    click(el.querySelector('button[aria-label="收起字段 command"]'))
    expect(el.querySelector('button[aria-label="展开字段 command"]')).toBeTruthy()
  })

  it('嵌套对象按格式化文本渲染', () => {
    const el = renderInvocation({ env: { NODE_ENV: 'test' } })
    const field = el.querySelector('[data-tool-field="env"]')
    expect(field?.textContent).toContain('NODE_ENV')
    expect(field?.textContent).toContain('test')
  })
})
