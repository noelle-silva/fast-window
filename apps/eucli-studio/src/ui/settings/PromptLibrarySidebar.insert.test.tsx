// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PromptLibrarySidebar } from './PromptLibrarySidebar'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

function layer() {
  return {
    folderId: '',
    crumbs: [{ id: '', name: '根层级' }],
    entries: [
      {
        kind: 'prompt',
        id: 'p1',
        key: 'prompt:p1',
        prompt: { id: 'p1', name: '提示词一', content: '正文', description: '', createdAt: '', updatedAt: '' },
      },
    ],
  } as any
}

describe('提示词库左栏的行内按钮', () => {
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

  function renderSidebar(overrides: Record<string, any> = {}) {
    act(() => {
      root.render(
        <PromptLibrarySidebar
          layer={layer()}
          selectedPromptId=""
          loading={false}
          dragDisabled
          drop={null}
          onBack={noop}
          onNavigate={noop}
          onSelectPrompt={noop}
          onCopyPrompt={noop}
          onInsertPrompt={noop}
          onReorderEntries={noop}
          onCollectEntry={noop}
          onMoveEntryToFolder={noop}
          onRenameFolder={noop}
          onDeleteFolder={noop}
          search=""
          onSearchChange={noop}
          onCreatePrompt={noop}
          onCreateFolder={noop}
          {...overrides}
        />,
      )
    })
  }

  it('按下填入按钮时阻止默认行为，输入框的焦点不会被抢走', () => {
    renderSidebar()
    const button = host?.querySelector('[aria-label="填入提示词内容"]') as HTMLElement | null
    expect(button).toBeTruthy()

    const event = new Event('pointerdown', { bubbles: true, cancelable: true })
    button!.dispatchEvent(event)

    // 阻止默认行为 = 浏览器不会把焦点从输入框挪到这个按钮上。
    expect(event.defaultPrevented).toBe(true)
  })

  it('没有可填的输入框时不出现填入按钮', () => {
    renderSidebar({ onInsertPrompt: undefined })
    expect(host?.querySelector('[aria-label="填入提示词内容"]')).toBeNull()
    expect(host?.querySelector('[aria-label="复制提示词内容"]')).not.toBeNull()
  })
})
