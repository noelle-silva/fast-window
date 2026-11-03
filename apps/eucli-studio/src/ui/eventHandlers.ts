// eucli-studio UI 事件处理器
// 由 V2 controller 组装使用
// 职责：click / wheel / mousedown / input / change / keydown / paste 事件委托与分发

import { clamp } from '../core/utils'
import { VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX } from '../core/viewerZoom'
import type { AiChatShowToast } from '../gateway/capabilities'

const DEAD_RENDER_ACTIONS = new Set([
  'side-tab',
  'pick-role',
  'ask-delete-role',
  'edit-provider',
  'close-provider-editor',
  'ask-delete-provider',
])

export function createEventHandlers(deps: {
  getState: () => any
  actions: Record<string, any>
  showToast?: AiChatShowToast
  clipboard?: { writeText?: (text: string) => Promise<void>; writeImage?: (...args: any[]) => void; readText?: () => Promise<string> }
}) {
  let mermaidDrag: any = null

  function cancelMermaidDrag() {
    const d = mermaidDrag
    if (!d) return
    mermaidDrag = null
    try {
      d.stage?.removeAttribute?.('data-mm-drag')
    } catch (_) {}
    try {
      window.removeEventListener('mousemove', onMouseMoveMermaid)
      window.removeEventListener('mouseup', onMouseUpMermaid)
      window.removeEventListener('blur', onMouseUpMermaid)
    } catch (_) {}
  }

  function onMouseMoveMermaid(e: MouseEvent) {
    const d = mermaidDrag
    if (!d) return
    e.preventDefault()
    const dx = Number(e.clientX || 0) - d.x
    const dy = Number(e.clientY || 0) - d.y
    d.stage.scrollLeft = d.sl - dx
    d.stage.scrollTop = d.st - dy
  }

  function onMouseUpMermaid(_e: Event) {
    if (!mermaidDrag) return
    cancelMermaidDrag()
  }

  function onClick(e: MouseEvent) {
    const t0 = e?.target
    if (!(t0 instanceof Element)) return

    let t: Element | null = t0
    let act = ''
    while (t) {
      if (t instanceof Element && t.getAttribute('data-stop') === '1') return
      act = (t instanceof Element && t.getAttribute('data-act')) || ''
      if (act) break
      t = t.parentElement
    }
    if (!t || !act) return

    if (DEAD_RENDER_ACTIONS.has(act)) {
      throw new Error(`事件动作 ${act} 依赖已删除的全局 render()，接线前必须改为域地址通知`)
    }

    if (act === 'open-mermaid') {
      deps.actions.openMermaidViewer(t)
      return
    }

    if (act === 'mm-prev' || act === 'mm-next') {
      const state = deps.getState()
      if (state.modal !== 'mermaid') return
      const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
      if (!len) return
      const delta = act === 'mm-prev' ? -1 : 1
      state.mermaid.index = (state.mermaid.index + delta + len) % len
      deps.actions.renderMermaidModalDom(true)
      return
    }

    if (act === 'mm-zoom-in' || act === 'mm-zoom-out' || act === 'mm-reset') {
      const state = deps.getState()
      if (state.modal !== 'mermaid') return
      if (act === 'mm-reset') state.mermaid.scale = 1
      else {
        const factor = act === 'mm-zoom-in' ? 1.12 : 1 / 1.12
        state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
      }
      deps.actions.applyMermaidScaleDom()
      return
    }

    if (act === 'close-modal') {
      deps.actions.closeModal()
      return
    }

    if (act === 'open-providers') return deps.actions.openProvidersEditor()
    if (act === 'new-role') return deps.actions.createRole()
    if (act === 'new-chat') return deps.actions.createChatForActiveTarget()

    if (act === 'edit-role') {
      const r = deps.actions.activeRole()
      if (r) deps.actions.openRoleEditor(String(r.id))
      return
    }

    if (act === 'edit-role-inline') return deps.actions.openRoleEditor(String(t.getAttribute('data-id') || ''))

    if (act === 'pick-chat') return deps.actions.pickChatForActiveTarget(String(t.getAttribute('data-id') || ''))

    if (act === 'pick-images') return deps.actions.pickDraftImages?.()
    if (act === 'rm-draft-img') {
      deps.actions.removeDraftImage(String(t.getAttribute('data-id') || ''))
      return
    }

    if (act === 'send') return deps.actions.sendChat()
    if (act === 'refresh-models') return deps.actions.refreshModels(String(deps.getState().draft.roleProviderId || ''), true)
    if (act === 'save-role') return deps.actions.saveRoleEditor()

    if (act === 'new-provider') return deps.actions.createProvider()

    if (act === 'save-provider') return deps.actions.saveProviderInlineEditor()

    if (act === 'confirm-delete') {
      void deps.actions.confirmDelete?.()
      return
    }

    if (act === 'copy-msg') {
      const id = String(t.getAttribute('data-id') || '')
      const chat = deps.actions.activeChat()
      const m = chat?.messages?.find((x: any) => String(x?.id) === id)
      if (!m) return
      deps.clipboard?.writeText?.(String(m.content || '')).then(
        () => deps.showToast?.('已复制', { kind: 'success' }),
        () => deps.showToast?.('复制失败', { kind: 'error' }),
      )
      return
    }
  }

  function onWheel(e: WheelEvent) {
    const state = deps.getState()
    if (state.modal !== 'mermaid') return
    const t = e?.target
    if (!(t instanceof Element)) return
    const stage = document.querySelector('[data-mm-stage="1"]')
    if (!(stage instanceof HTMLElement)) return
    if (!stage.contains(t)) return

    e.preventDefault()
    e.stopPropagation()
    const dir = Number(e?.deltaY || 0) < 0 ? 1 : -1
    const factor = dir > 0 ? 1.08 : 1 / 1.08
    state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
    deps.actions.applyMermaidScaleDom()
  }

  function onMouseDown(e: MouseEvent) {
    const state = deps.getState()
    if (state.modal !== 'mermaid') return
    const t = e?.target
    if (!(t instanceof Element)) return
    if (e.button !== 1) return

    const stage = document.querySelector('[data-mm-stage="1"]')
    if (!(stage instanceof HTMLElement)) return
    if (!stage.contains(t)) return

    e.preventDefault()
    e.stopPropagation()

    mermaidDrag = {
      stage,
      x: Number(e.clientX || 0),
      y: Number(e.clientY || 0),
      sl: Number(stage.scrollLeft || 0),
      st: Number(stage.scrollTop || 0),
    }
    stage.setAttribute('data-mm-drag', '1')

    try {
      window.addEventListener('mousemove', onMouseMoveMermaid, { passive: false })
      window.addEventListener('mouseup', onMouseUpMermaid, { passive: true })
      window.addEventListener('blur', onMouseUpMermaid, { passive: true })
    } catch (_) {
      window.addEventListener('mousemove', onMouseMoveMermaid)
      window.addEventListener('mouseup', onMouseUpMermaid)
      window.addEventListener('blur', onMouseUpMermaid)
    }
  }

  function onInput(e: Event) {
    const t = e?.target
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) return
    const bind = t.getAttribute('data-bind') || ''
    if (!bind) return
    const state = deps.getState()
    if (bind === 'input') {
      deps.actions.setComposerInput?.(t.value)
      return
    }
    state.draft[bind] = t.value
  }

  function onChange(e: Event) {
    const t = e?.target
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) return
    const bind = t.getAttribute('data-bind') || ''
    if (!bind) return
    if (bind === 'input') {
      deps.actions.setComposerInput?.(t.value)
      return
    }
    deps.getState().draft[bind] = t.value
  }

  function onKeyDown(e: KeyboardEvent) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    if (t.getAttribute('data-bind') !== 'input') return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      deps.actions.sendChat()
    }
  }

  function onPaste(e: ClipboardEvent) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    if (t.getAttribute('data-bind') !== 'input') return
    const dt = e?.clipboardData
    const items = dt?.items ? Array.from(dt.items) : []
    const files: File[] = []
    for (const it of items) {
      if (!it || it.kind !== 'file') continue
      const type = String(it.type || '')
      if (!type.startsWith('image/')) continue
      const f = it.getAsFile?.()
      if (f) files.push(f)
    }
    if (!files.length) return

    e.preventDefault()
    e.stopPropagation()

    deps.actions.addDraftImagesFromFiles?.(files)
  }

  return {
    onClick,
    onWheel,
    onMouseDown,
    onInput,
    onChange,
    onKeyDown,
    onPaste,
    cancelMermaidDrag,
  }
}
