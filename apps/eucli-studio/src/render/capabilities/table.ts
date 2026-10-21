import { ICON_COPY, ICON_FAIL, ICON_IMAGE, ICON_OK } from '../icons'
import type { RenderCapability } from '../contract'

// ============================================================================
// 表格能力：给 Markdown / HTML 表格挂上「复制图像 / 复制源码」工具条。
//
// 与图表、公式一致：只在新增片段上装饰，事件在根节点委托一次。
// 表格外层包一层 .fw-table-wrap，用于定位工具条（表格自身不适合做定位容器）。
// ============================================================================

const WRAP_CLASS = 'fw-table-wrap'
const TOOLBAR_CLASS = 'fw-table-toolbar'
const ACTION_CLASS = 'fw-table-action'

function setActionState(btn: HTMLButtonElement, state: 'copy' | 'ok' | 'fail', act: 'image' | 'source') {
  if (state === 'ok') {
    btn.innerHTML = ICON_OK
    btn.setAttribute('data-state', 'ok')
    btn.setAttribute('title', '已复制')
    btn.setAttribute('aria-label', '已复制')
    return
  }
  if (state === 'fail') {
    btn.innerHTML = ICON_FAIL
    btn.setAttribute('data-state', 'fail')
    btn.setAttribute('title', '复制失败')
    btn.setAttribute('aria-label', '复制失败')
    return
  }
  btn.innerHTML = act === 'image' ? ICON_IMAGE : ICON_COPY
  btn.removeAttribute('data-state')
  const label = act === 'image' ? '复制表格图像' : '复制表格源码'
  btn.setAttribute('title', label)
  btn.setAttribute('aria-label', label)
}

function buildToolbar(): HTMLDivElement {
  const toolbar = document.createElement('div')
  toolbar.className = TOOLBAR_CLASS

  const imageBtn = document.createElement('button')
  imageBtn.type = 'button'
  imageBtn.className = ACTION_CLASS
  imageBtn.setAttribute('data-act', 'copy-table-image')
  setActionState(imageBtn, 'copy', 'image')

  const sourceBtn = document.createElement('button')
  sourceBtn.type = 'button'
  sourceBtn.className = ACTION_CLASS
  sourceBtn.setAttribute('data-act', 'copy-table-source')
  setActionState(sourceBtn, 'copy', 'source')

  toolbar.appendChild(imageBtn)
  toolbar.appendChild(sourceBtn)
  return toolbar
}

// 从表格 DOM 还原成标准 Markdown 表格文本。
export function tableToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (!rows.length) return ''

  const cellsOf = (tr: Element) =>
    Array.from(tr.querySelectorAll('th,td')).map((cell) => String(cell.textContent || '').trim().replace(/\n+/g, ' '))

  const header = cellsOf(rows[0])
  if (!header.length) return ''

  const lines = ['| ' + header.join(' | ') + ' |', '|' + header.map(() => ' --- ').join('|') + '|']
  for (let i = 1; i < rows.length; i++) {
    lines.push('| ' + cellsOf(rows[i]).join(' | ') + ' |')
  }
  return lines.join('\n')
}

async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (_) {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return !!ok
  } catch (_) {}
  return false
}

// 把表格渲染成 PNG 并写入剪贴板（DOM → SVG foreignObject → canvas）。
async function copyTableImage(table: HTMLTableElement): Promise<boolean> {
  try {
    const rect = table.getBoundingClientRect()
    if (!rect.width || !rect.height) return false

    const pad = 20
    const clone = table.cloneNode(true) as HTMLTableElement
    clone.style.margin = '0'

    const holder = document.createElement('div')
    holder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    holder.style.cssText = `display:inline-block;background:#ffffff;padding:${pad}px;font-family:system-ui,"Microsoft YaHei",sans-serif`
    holder.appendChild(clone)

    const cssText = Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules || [])
            .map((rule) => rule.cssText)
            .join('\n')
        } catch (_) {
          return ''
        }
      })
      .join('\n')

    const w = Math.ceil(rect.width) + pad * 2
    const h = Math.ceil(rect.height) + pad * 2
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml"><style>${cssText}</style>${new XMLSerializer().serializeToString(holder)}</div>` +
      `</foreignObject></svg>`

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const png: Blob = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = w * 2
        canvas.height = h * 2
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(url)
          reject(new Error('no canvas context'))
          return
        }
        ctx.scale(2, 2)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0)
        canvas.toBlob((out) => {
          URL.revokeObjectURL(url)
          if (out) resolve(out)
          else reject(new Error('toBlob failed'))
        }, 'image/png')
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('svg load failed'))
      }
      img.src = url
    })

    if (!navigator?.clipboard?.write) return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    return true
  } catch (_) {
    return false
  }
}

function ensureTableHandlerOnce(host: HTMLElement) {
  if (host.getAttribute('data-fw-table-hook') === '1') return
  host.setAttribute('data-fw-table-hook', '1')

  host.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    const btn = target?.closest?.(`button.${ACTION_CLASS}`)
    if (!(btn instanceof HTMLButtonElement)) return

    const wrap = btn.closest(`.${WRAP_CLASS}`)
    const table = wrap?.querySelector('table')
    if (!(table instanceof HTMLTableElement)) return

    event.preventDefault()
    event.stopPropagation()

    const act = btn.getAttribute('data-act') === 'copy-table-image' ? 'image' : 'source'
    btn.disabled = true

    const task = act === 'image' ? copyTableImage(table) : copyText(tableToMarkdown(table))
    Promise.resolve(task)
      .then((ok) => setActionState(btn, ok ? 'ok' : 'fail', act))
      .catch(() => setActionState(btn, 'fail', act))
      .finally(() => {
        window.setTimeout(() => {
          if (!btn.isConnected) return
          setActionState(btn, 'copy', act)
          btn.disabled = false
        }, 1500)
      })
  })
}

export function createTableCapability(): RenderCapability {
  return {
    id: 'table',
    decorate(fragment) {
      const tables = Array.from(fragment.querySelectorAll?.('table') || [])
      for (const table of tables) {
        if (!(table instanceof HTMLTableElement)) continue
        if (table.closest(`.${WRAP_CLASS}`)) continue

        const wrap = document.createElement('div')
        wrap.className = WRAP_CLASS
        table.replaceWith(wrap)
        wrap.appendChild(table)
        wrap.appendChild(buildToolbar())
      }
    },
    bind(host) {
      ensureTableHandlerOnce(host)
    },
    permissions: ['clipboard.writeText', 'clipboard.writeImage', 'ui.showToast'],
  }
}
