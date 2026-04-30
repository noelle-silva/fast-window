// ai-chat UI 事件处理器
// 提取自 controller/createController.ts
// 职责：click / wheel / mousedown / input / change / keydown / paste 事件委托与分发

import { clamp } from '../core/utils'
import { VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX } from '../core/viewerZoom'

const MAX_DRAFT_IMAGES = 8

export function createEventHandlers(deps: {
  getState: () => any
  actions: Record<string, any>
  emit: () => void
  render: () => void
  showToast?: (msg: any) => void
  clipboard?: { writeText?: (text: string) => Promise<void>; writeImage?: (...args: any[]) => void; readText?: () => Promise<string> }
  pickImages?: () => void
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

  function onMouseUpMermaid(_e: MouseEvent) {
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

    if (act === 'side-tab') {
      const state = deps.getState()
      const tab = String(t.getAttribute('data-tab') || '')
      state.sideTab = tab === 'chats' ? 'chats' : 'roles'
      deps.render()
      return
    }

    if (act === 'close-modal') {
      deps.actions.closeModal()
      return
    }

    if (act === 'toggle-stream') {
      const state = deps.getState()
      if (!state.data) return
      state.data.settings.streamEnabled = !state.data.settings.streamEnabled
      deps.actions.save().catch(() => {})
      deps.actions.renderTop()
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

    if (act === 'pick-role') {
      const state = deps.getState()
      state.draft.activeRoleId = String(t.getAttribute('data-id') || '')
      deps.actions.ensureChatsBox(state.draft.activeRoleId)
      deps.actions.save().catch(() => {})
      deps.render()
      deps.actions.scrollToBottomSoon()
      return
    }

    if (act === 'pick-chat') return deps.actions.pickChatForActiveTarget(String(t.getAttribute('data-id') || ''))

    if (act === 'pick-images') return deps.pickImages?.()
    if (act === 'rm-draft-img') {
      deps.actions.removeDraftImage(String(t.getAttribute('data-id') || ''))
      deps.actions.renderComposer()
      return
    }

    if (act === 'send') return deps.actions.sendChat()
    if (act === 'refresh-models') return deps.actions.refreshModels(String(deps.getState().draft.roleProviderId || ''), true)
    if (act === 'save-role') return deps.actions.saveRoleEditor()

    if (act === 'ask-delete-role') {
      const state = deps.getState()
      state.draft.deleteRoleId = String(t.getAttribute('data-id') || '')
      state.draft.deleteProviderId = ''
      state.modal = 'confirm'
      deps.render()
      return
    }

    if (act === 'new-provider') return deps.actions.createProvider()

    if (act === 'edit-provider') {
      const state = deps.getState()
      const pid = String(t.getAttribute('data-id') || '')
      if (String(state.draft.editProviderId || '') === pid) state.draft.editProviderId = ''
      else deps.actions.openProviderInlineEditor(pid)
      deps.render()
      return
    }

    if (act === 'close-provider-editor') {
      const state = deps.getState()
      state.draft.editProviderId = ''
      deps.render()
      return
    }

    if (act === 'save-provider') return deps.actions.saveProviderInlineEditor()

    if (act === 'ask-delete-provider') {
      const state = deps.getState()
      state.draft.deleteProviderId = String(t.getAttribute('data-id') || '')
      state.draft.deleteRoleId = ''
      state.modal = 'confirm'
      deps.render()
      return
    }

    if (act === 'confirm-delete') {
      const state = deps.getState()
      const rid = String(state.draft.deleteRoleId || '')
      const pid = String(state.draft.deleteProviderId || '')
      deps.actions.closeModal()
      if (rid) deps.actions.deleteRole(rid)
      if (pid) deps.actions.deleteProvider(pid)
      deps.render()
      return
    }

    if (act === 'copy-msg') {
      const id = String(t.getAttribute('data-id') || '')
      const chat = deps.actions.activeChat()
      const m = chat?.messages?.find((x: any) => String(x?.id) === id)
      if (!m) return
      deps.clipboard?.writeText?.(String(m.content || '')).then(
        () => deps.showToast?.('已复制'),
        () => deps.showToast?.('复制失败'),
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
    if (!(t instanceof HTMLElement)) return
    const bind = t.getAttribute('data-bind') || ''
    if (!bind) return
    const state = deps.getState()
    state.draft[bind] = t.value
  }

  function onChange(e: Event) {
    const t = e?.target
    if (!(t instanceof HTMLElement)) return
    const bind = t.getAttribute('data-bind') || ''
    if (!bind) return
    const state = deps.getState()
    state.draft[bind] = t.value

    if (bind === 'roleProviderId') {
      const p = deps.actions.getProvider(String(state.draft.roleProviderId || ''))
      const cachedItems = Array.isArray(p?.modelsCache?.items) ? p.modelsCache.items : []
      state.models = { loading: false, error: '', items: cachedItems.slice(0, 300) }
      state.draft.roleModelId = ''
      state.draft.roleCustomModelId = ''
      deps.render()
      return
    }

    if (bind === 'roleModelId') {
      deps.render()
      return
    }
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
    const state = deps.getState()
    if (state.loading || state.sending) return

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

    const left = Math.max(0, MAX_DRAFT_IMAGES - (Array.isArray(state.draft.images) ? state.draft.images.length : 0))
    if (!left) return deps.showToast?.(`最多选择 ${MAX_DRAFT_IMAGES} 张图片`)

    e.preventDefault()
    e.stopPropagation()

    ;(async () => {
      let added = 0
      for (const f of files.slice(0, left)) {
        try {
          const dataUrl = await deps.actions.readFileAsDataUrl(f)
          if (deps.actions.addDraftImage(String(f?.name || '粘贴图片'), dataUrl)) added++
        } catch (_) {}
      }
      if (!added) deps.showToast?.('未识别到图片')
      deps.actions.renderComposer()
    })().catch(() => {})
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
