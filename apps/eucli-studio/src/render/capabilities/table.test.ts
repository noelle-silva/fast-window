// @vitest-environment happy-dom
//
// 表格能力：结构与尺寸归一。
// - 三层结构固定（定位层 / 滚动层 / 表格），工具条与滑块都挂在定位层
// - 模型直出的内联尺寸被剥掉，非尺寸的内联样式原样保留
import { describe, expect, it } from 'vitest'
import { createTableCapability } from './table'
import type { RenderContext } from '../contract'

const CTX = {} as RenderContext

function decorateHtml(html: string): DocumentFragment {
  const host = document.createElement('div')
  host.innerHTML = html
  const fragment = document.createDocumentFragment()
  while (host.firstChild) fragment.appendChild(host.firstChild)
  createTableCapability().decorate?.(fragment, CTX)
  return fragment
}

describe('表格能力：结构', () => {
  it('表格包在滚动层里，定位层同时挂工具条与滑块', () => {
    const fragment = decorateHtml('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>')

    const wrap = fragment.querySelector('.fw-table-wrap')
    const scroller = fragment.querySelector('.fw-table-scroll')
    const table = fragment.querySelector('table')

    expect(wrap).toBeTruthy()
    expect(scroller).toBeTruthy()
    expect(table).toBeTruthy()
    expect(scroller?.parentElement).toBe(wrap)
    expect(table?.parentElement).toBe(scroller)
    expect(wrap?.querySelectorAll('button.fw-table-action').length).toBe(2)
    expect(wrap?.querySelector('[role="scrollbar"][aria-orientation="horizontal"]')).toBeTruthy()
  })

  it('重复装饰不会套娃', () => {
    const fragment = decorateHtml('<table><tbody><tr><td>1</td></tr></tbody></table>')
    const wrap = fragment.querySelector('.fw-table-wrap') as HTMLElement

    const nested = document.createDocumentFragment()
    nested.appendChild(wrap)
    createTableCapability().decorate?.(nested, CTX)

    expect(nested.querySelectorAll('.fw-table-wrap').length).toBe(1)
    expect(nested.querySelectorAll('.fw-table-scroll').length).toBe(1)
    expect(nested.querySelectorAll('table').length).toBe(1)
  })
})

describe('表格能力：尺寸归一', () => {
  it('剥掉表格与单元格的内联尺寸，保留其他内联样式', () => {
    const fragment = decorateHtml(
      '<table width="100%" style="width:100%; min-width:900px; table-layout:fixed; border:1px solid red">' +
        '<colgroup><col width="300" style="width:300px"></colgroup>' +
        '<thead><tr><th width="200" style="width:200px; color:blue">A</th></tr></thead>' +
        '<tbody><tr><td style="width:120px; padding:2px">1</td></tr></tbody>' +
        '</table>',
    )

    const table = fragment.querySelector('table') as HTMLTableElement
    expect(table.hasAttribute('width')).toBe(false)
    expect(table.style.width).toBe('')
    expect(table.style.minWidth).toBe('')
    expect(table.style.tableLayout).toBe('')
    expect(table.style.border).toContain('1px solid red')

    const col = fragment.querySelector('col') as HTMLTableColElement
    expect(col.hasAttribute('width')).toBe(false)
    expect(col.style.width).toBe('')

    const th = fragment.querySelector('th') as HTMLTableCellElement
    expect(th.hasAttribute('width')).toBe(false)
    expect(th.style.width).toBe('')
    expect(th.style.color).toBe('blue')

    const td = fragment.querySelector('td') as HTMLTableCellElement
    expect(td.style.width).toBe('')
    expect(td.style.padding).toBe('2px')
  })
})
