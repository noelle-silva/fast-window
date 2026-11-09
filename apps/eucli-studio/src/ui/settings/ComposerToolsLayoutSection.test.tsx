// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerToolsLayoutSection } from './ComposerToolsLayoutSection'
import { normalizeComposerToolsLayout } from '../../domain/composerToolsLayout'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('输入区按钮布局设置分区', () => {
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

  const render = (layout: unknown, actions: Record<string, any>) => {
    const controller = { actions }
    act(() => {
      root.render(
        <ComposerToolsLayoutSection
          controller={controller}
          loading={false}
          layout={normalizeComposerToolsLayout(layout)}
        />,
      )
    })
  }

  it('cancelling a toolbar row asks to move that button into the menu', () => {
    const setComposerToolOnToolbar = vi.fn()
    render(undefined, { setComposerToolOnToolbar })

    const input = host!.querySelector('input[aria-label="添加图片 显示在工具条"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.checked).toBe(true)

    act(() => {
      input.click()
    })

    expect(setComposerToolOnToolbar).toHaveBeenCalledWith('image-picker', false)
  })

  it('checking a menu row asks to move that button onto the toolbar', () => {
    const setComposerToolOnToolbar = vi.fn()
    render(undefined, { setComposerToolOnToolbar })

    const input = host!.querySelector('input[aria-label="清洗思维链 显示在工具条"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.checked).toBe(false)

    act(() => {
      input.click()
    })

    expect(setComposerToolOnToolbar).toHaveBeenCalledWith('clean-reasoning', true)
  })

  it('lists every registered button exactly once across the two areas', () => {
    render(undefined, {})

    const labels = Array.from(host!.querySelectorAll('input[type="checkbox"]')).map((node) =>
      node.getAttribute('aria-label'),
    )
    expect(labels).toHaveLength(9)
    expect(new Set(labels).size).toBe(9)
  })
})
