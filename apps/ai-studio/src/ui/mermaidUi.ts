import { clamp, now } from '../core/utils'
import { VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX } from '../core/viewerZoom'
import { splitChatKey } from '../domain/storageKeys'

export function createMermaidUi(deps: {
  getState: () => any
  assistantRenderer: any
  save: () => Promise<void>
  emit: () => void
  loadSplitMeta: () => Promise<any>
  storage: { get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<void> }
  aiGenerateChatTitle?: (rid: string, cid: string) => Promise<any>
  locateMessageInActiveChat: (mid: string) => any
  chatHasPendingAssistant: (chat: any) => boolean
  activeRole: () => any
  getStickerRelPath: (cat: string, name: string) => string
  resolveToolRequestRenderPreset: (presetName: string, userPresets?: any) => any
  uiStreamCache: Map<string, any>
}) {
  const {
    getState,
    assistantRenderer,
    save,
    emit,
    loadSplitMeta,
    storage,
    locateMessageInActiveChat,
    chatHasPendingAssistant,
    activeRole,
    getStickerRelPath,
    resolveToolRequestRenderPreset,
    uiStreamCache,
  } = deps

  const { renderAssistantInto: renderAssistantIntoRaw, sanitizeHtml, sanitizeSvg } = assistantRenderer

  function currentRenderSafetyPolicy() {
    const s = getState()
    const v = String((s.data?.settings as any)?.renderSafetyPolicy || '').trim()
    return v === 'unsafe' ? 'unsafe' : v === 'baseline' ? 'baseline' : 'original'
  }

  function renderAssistantInto(el: HTMLElement, text: string) {
    const s = getState()
    const enabled = !!s.data?.settings?.stickers?.enabled
    const activeId = String(s.data?.settings?.toolRequestRenderPreset || 'classic')
    const userPresets = (s.data?.settings as any)?.toolRequestRenderPresets
    const resolved = resolveToolRequestRenderPreset(activeId, userPresets)
    const renderSafetyPolicy = currentRenderSafetyPolicy()
    renderAssistantIntoRaw(el, text, {
      stickersEnabled: enabled,
      getStickerPath: getStickerRelPath,
      toolRequestPreset: resolved,
      renderSafetyPolicy,
    })
  }

  function mermaidItemsFromDom() {
    const chat = document.querySelector('[data-area="chat"]')
    const list = Array.from(chat?.querySelectorAll?.('.mermaid-block[data-mermaid="1"]') || [])
    const items: any[] = []
    for (const b of list) {
      if (!(b instanceof HTMLElement)) continue
      const svgEl = b.querySelector('svg')
      const renderSafetyPolicy = currentRenderSafetyPolicy()
      if (svgEl) items.push({ svg: sanitizeSvg(svgEl.outerHTML || '', renderSafetyPolicy) })
      else items.push({ svg: sanitizeHtml(b.innerHTML || '', renderSafetyPolicy) })
    }
    return { blocks: list, items }
  }

  function mermaidModalEls() {
    const root = document.querySelector('[data-mm-modal="1"]')
    if (!(root instanceof HTMLElement)) return null
    const stage = root.querySelector('[data-mm-stage="1"]')
    const canvas = root.querySelector('[data-mm-canvas="1"]')
    const label = root.querySelector('[data-mm-label="1"]')
    const zoom = root.querySelector('[data-mm-zoom="1"]')
    const prev = root.querySelector('[data-act="mm-prev"]')
    const next = root.querySelector('[data-act="mm-next"]')
    return {
      root,
      stage: stage instanceof HTMLElement ? stage : null,
      canvas: canvas instanceof HTMLElement ? canvas : null,
      label: label instanceof HTMLElement ? label : null,
      zoom: zoom instanceof HTMLElement ? zoom : null,
      prev: prev instanceof HTMLButtonElement ? prev : null,
      next: next instanceof HTMLButtonElement ? next : null,
    }
  }

  function applyMermaidScaleDom() {
    const s = getState()
    if (s.modal !== 'mermaid') return
    const els = mermaidModalEls()
    if (!els?.canvas) return
    const scale = clamp(s.mermaid.scale, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
    s.mermaid.scale = scale
    els.canvas.style.transform = `scale(${scale})`
    if (els.zoom) els.zoom.textContent = `${Math.round(scale * 100)}%`
  }

  function renderMermaidModalDom(resetScroll: boolean) {
    const s = getState()
    if (s.modal !== 'mermaid') return
    const els = mermaidModalEls()
    if (!els?.canvas) return
    const len = Array.isArray(s.mermaid.items) ? s.mermaid.items.length : 0
    if (!len) return

    const idx = clamp(s.mermaid.index, 0, len - 1)
    s.mermaid.index = idx

    const svg = String(s.mermaid.items[idx]?.svg || '')
    els.canvas.innerHTML = svg || `<div class="muted">空图</div>`
    if (els.label) els.label.textContent = `${idx + 1}/${len}`
    if (els.prev) els.prev.disabled = len <= 1
    if (els.next) els.next.disabled = len <= 1

    if (resetScroll && els.stage) {
      els.stage.scrollTop = 0
      els.stage.scrollLeft = 0
    }

    applyMermaidScaleDom()
  }

  function openMermaidViewer(blockEl: Element | null) {
    const srcEl = blockEl instanceof Element ? blockEl : null
    const r = mermaidItemsFromDom()
    if (!r.items.length) return

    let idx = 0
    if (srcEl) {
      const i = (r.blocks as Element[]).findIndex((b) => b === srcEl || (b instanceof HTMLElement && b.contains(srcEl)))
      if (i >= 0) idx = i
    }

    const s = getState()
    s.mermaid.items = r.items
    s.mermaid.index = idx
    s.mermaid.scale = 1
    s.modal = 'mermaid'
    emit()
    renderMermaidModalDom(true)
  }

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

  const mermaidFixWriteQueue = new Map<string, Promise<void>>()

  function enqueueMermaidFixWrite<T>(messageId: string, fn: () => Promise<T>) {
    const mid = String(messageId || '').trim()
    if (!mid) return Promise.reject(new Error('未找到消息ID'))

    const prev = mermaidFixWriteQueue.get(mid) || Promise.resolve()
    const run = prev.catch(() => {}).then(fn)
    const completion = run.then(
      () => {},
      () => {},
    )
    mermaidFixWriteQueue.set(mid, completion)
    completion.finally(() => {
      if (mermaidFixWriteQueue.get(mid) === completion) mermaidFixWriteQueue.delete(mid)
    })
    return run
  }

  async function patchMessageContentSilent(messageId: string, content: string) {
    const s = getState()
    if (s.loading || !s.data) throw new Error('数据未加载')
    if (s.sending) throw new Error('操作中，请稍后重试')

    const found = locateMessageInActiveChat(messageId)
    if (!found) throw new Error('未找到该消息')

    const { chat, pendingChat, target } = found
    if (pendingChat) throw new Error('当前会话尚未写入存档，请先发送一条消息后再修复')
    if (chatHasPendingAssistant(chat)) throw new Error('该会话正在生成中，无法编辑')
    if (target.role === 'assistant') {
      if (target.pending) throw new Error('该消息正在生成中，无法编辑')
      try {
        uiStreamCache.delete(String(messageId || ''))
      } catch (_) {}
    }

    target.content = String(content ?? '')
    chat.updatedAt = now()
    emit()
    await save()

    try {
      const role = activeRole()
      const rid = String(role?.id || '')
      const cid = String(chat?.id || '')
      const mid = String(messageId || '')
      if (rid && cid && mid) {
        const meta = await loadSplitMeta()
        const folder = meta ? String(meta.roleFolders?.[rid] || '') : ''
        if (folder) {
          const raw = await storage.get(splitChatKey(folder, cid))
          const saved = raw && typeof raw === 'object' ? raw : null
          const msgs = Array.isArray(saved?.messages) ? saved.messages : []
          const m = msgs.find((x: any) => String(x?.id || '') === mid) || null
          const savedContent = m ? String(m.content ?? '') : ''
          const expected = String(target.content ?? '')
          if (savedContent !== expected) throw new Error('存档未更新（storage 写入可能失败或被拦截）')
        }
      }
    } catch (e: any) {
      throw new Error(String(e?.message || e || '存档校验失败'))
    }
  }

  return {
    currentRenderSafetyPolicy,
    renderAssistantInto,
    mermaidItemsFromDom,
    mermaidModalEls,
    applyMermaidScaleDom,
    renderMermaidModalDom,
    openMermaidViewer,
    cancelMermaidDrag,
    onMouseMoveMermaid,
    onMouseUpMermaid,
    enqueueMermaidFixWrite,
    patchMessageContentSilent,
  }
}
