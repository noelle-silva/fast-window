// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { refreshScopes } from '../domain/uiRefreshScope'
import { createMermaidUi } from './mermaidUi'

describe('Mermaid 查看器通知', () => {
  it('打开查看器只通知 uiShell', () => {
    document.body.innerHTML = '<div data-area="chat"><div class="mermaid-block" data-mermaid="1"><svg></svg></div></div>'
    const state: any = { data: {}, modal: '', mermaid: { items: [], index: 0, scale: 1 } }
    const emitScope = vi.fn()
    const ui = createMermaidUi({
      getState: () => state,
      assistantRenderer: { sanitizeHtml: (html: any) => String(html || ''), sanitizeSvg: (svg: any) => String(svg || '') },
      emitScope,
    })

    ui.openMermaidViewer(null)

    expect(state.modal).toBe('mermaid')
    expect(emitScope).toHaveBeenCalledWith(refreshScopes.uiShell())
  })
})
