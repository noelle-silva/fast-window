import { clamp, now } from '../../core/utils'
import { IMAGE_VIEWER_ZOOM_MAX, MERMAID_VIEWER_ZOOM_MAX, VIEWER_ZOOM_MIN } from '../../core/viewerZoom'
import { refreshScopes } from '../../domain/uiRefreshScope'
import { workspaceRoleTargetId } from '../../domain/workspaceRoleTarget'
import type { AiChatShowToast } from '../../gateway/capabilities'

export function createViewerActions(deps: {
  state: any
  emitScope: (scope: string) => void
  showToast?: AiChatShowToast
  activeChatFromData: () => any
  sanitizeSvg: (svg: any, renderSafetyPolicy?: any) => string
  currentRenderSafetyPolicy: () => string
  locateMessageInActiveChat: (messageId: any) => any
  aiFixMermaidInMessage: (roleId: string, sessionId: string, messageId: string, mermaidSrc: string, renderError: string, workspaceId?: string) => Promise<any>
  reloadRoleSession: (roleId: string, sessionId: string) => Promise<any>
  reloadWorkspaceSession: (workspaceId: string, roleId: string, sessionId: string) => Promise<any>
}) {
  const { state, emitScope, showToast, activeChatFromData, sanitizeSvg, currentRenderSafetyPolicy, locateMessageInActiveChat, aiFixMermaidInMessage, reloadRoleSession, reloadWorkspaceSession } = deps

  // 查看器开关、翻页、缩放都是页面级 UI 状态：只属于 uiShell。
  function emitViewerShell() {
    emitScope(refreshScopes.uiShell())
  }

  return {
    aiFixMermaid: (messageId: any, mermaidSrc: any, renderErrorMsg: any) => {
      let t0 = 0
      const cost = () => ((now() - t0) / 1000).toFixed(1)
      let roleId = ''
      let workspaceId = ''
      let sessionId = ''
      let mid = ''
      let targetKind: 'role' | 'workspace' = 'role'
      return Promise.resolve()
        .then(() => {
          const located = locateMessageInActiveChat(String(messageId || ''))
          const kind = String(located?.kind || '')
          if (!located || (kind !== 'role' && kind !== 'workspace')) throw new Error('当前会话暂未接入 Mermaid AI 修复')
          targetKind = kind
          sessionId = String(located.chat?.id || '').trim()
          workspaceId = kind === 'workspace' ? String(located.targetId || '').trim() : ''
          roleId = kind === 'workspace' ? String((located.chat as any)?.roleId || state.draft?.activeRoleId || '').trim() : String(located.targetId || '').trim()
          mid = String(messageId || '').trim()
          if (!roleId || !sessionId || !mid) throw new Error('Mermaid 修复上下文不完整')
          t0 = now()
          showToast?.('AI 修复 Mermaid 中…')
          return aiFixMermaidInMessage(roleId, sessionId, mid, String(mermaidSrc || ''), String(renderErrorMsg || ''), workspaceId || undefined)
        })
        .then((fixed: any) => {
          const nextMermaid = String((fixed as any)?.mermaidSource || '').trim()
          const reload = workspaceId ? reloadWorkspaceSession(workspaceId, roleId, sessionId) : reloadRoleSession(roleId, sessionId)
          return reload.then(() => {
            if (!activeChatFromData()) throw new Error('Mermaid 修复已完成，但刷新最新会话失败')
            // 修复写回的是消息正文：按会话 + 列表预览地址通知，不动页面壳层。
            const targetId = targetKind === 'workspace' ? workspaceRoleTargetId(workspaceId, roleId) : roleId
            emitScope(refreshScopes.session(targetKind, targetId, sessionId))
            emitScope(refreshScopes.chatList(targetKind, targetId))
            showToast?.(`Mermaid 已修复（${cost()}s）`, { kind: 'success' })
            return nextMermaid || fixed
          })
        })
        .catch((e: any) => {
          const msg = String(e?.message || e || 'AI 修复 Mermaid 失败')
          showToast?.(`AI 修复 Mermaid 失败（${cost()}s）：${msg}`, { kind: 'error' })
          throw e
        })
    },
    openMermaidViewer: (rootEl: any, srcEl: any) => {
      const root = rootEl instanceof Element ? rootEl : document.body
      const blocks = Array.from(root.querySelectorAll?.('.mermaid-block[data-mermaid="1"]') || [])
      const items: any[] = []
      const renderSafetyPolicy = currentRenderSafetyPolicy()
      for (const b of blocks) {
        const svg = b instanceof HTMLElement ? String(b.innerHTML || '') : ''
        if (!svg) continue
        items.push({ svg: sanitizeSvg(svg, renderSafetyPolicy) })
      }
      if (!items.length) return

      let idx = 0
      const src = srcEl instanceof Element ? srcEl : null
      if (src) {
        const i = blocks.findIndex((b) => b === src || (b instanceof HTMLElement && b.contains(src)))
        if (i >= 0) idx = i
      }
      state.mermaid.items = items
      state.mermaid.index = clamp(idx, 0, Math.max(0, items.length - 1))
      state.mermaid.scale = 1
      state.modal = 'mermaid'
      emitViewerShell()
    },
    openImageViewer: (rootEl: any, srcEl: any) => {
      const root = rootEl instanceof Element ? rootEl : document.body
      const imgs = Array.from(root.querySelectorAll?.('img[data-fw-img="1"]') || [])
      const items: any[] = []
      const elToIdx = new Map()
      for (const img of imgs) {
        if (!(img instanceof HTMLImageElement)) continue
        const src = String(img.getAttribute('src') || '').trim()
        if (!src) continue
        const idx = items.length
        items.push({ src, alt: globalThis.String(img.getAttribute('alt') || '图片') })
        elToIdx.set(img, idx)
      }
      if (!items.length) return

      let idx = 0
      const src = srcEl instanceof Element ? srcEl : null
      if (src) {
        const img = src instanceof HTMLImageElement ? src : (src.closest?.('img[data-fw-img="1"]') as any)
        const i = img instanceof HTMLImageElement ? elToIdx.get(img) : -1
        if (typeof i === 'number' && i >= 0) idx = i
      }

      state.imageViewer.items = items
      state.imageViewer.index = clamp(idx, 0, Math.max(0, items.length - 1))
      state.imageViewer.scale = 1
      state.modal = 'image'
      emitViewerShell()
    },
    mermaidPrev: () => {
      const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
      if (!len) return
      state.mermaid.index = (Number(state.mermaid.index || 0) - 1 + len) % len
      state.mermaid.scale = 1
      emitViewerShell()
    },
    mermaidNext: () => {
      const len = Array.isArray(state.mermaid.items) ? state.mermaid.items.length : 0
      if (!len) return
      state.mermaid.index = (Number(state.mermaid.index || 0) + 1) % len
      state.mermaid.scale = 1
      emitViewerShell()
    },
    mermaidZoom: (dir: any) => {
      const factor = Number(dir || 0) >= 0 ? 1.12 : 1 / 1.12
      state.mermaid.scale = clamp(Number(state.mermaid.scale || 1) * factor, VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
      emitViewerShell()
    },
    mermaidSetScale: (scale: any) => {
      state.mermaid.scale = clamp(Number(scale || 1), VIEWER_ZOOM_MIN, MERMAID_VIEWER_ZOOM_MAX)
      emitViewerShell()
    },
    mermaidReset: () => {
      state.mermaid.scale = 1
      emitViewerShell()
    },
    imagePrev: () => {
      const len = Array.isArray(state.imageViewer.items) ? state.imageViewer.items.length : 0
      if (!len) return
      state.imageViewer.index = (Number(state.imageViewer.index || 0) - 1 + len) % len
      state.imageViewer.scale = 1
      emitViewerShell()
    },
    imageNext: () => {
      const len = Array.isArray(state.imageViewer.items) ? state.imageViewer.items.length : 0
      if (!len) return
      state.imageViewer.index = (Number(state.imageViewer.index || 0) + 1) % len
      state.imageViewer.scale = 1
      emitViewerShell()
    },
    imageZoom: (dir: any) => {
      const factor = Number(dir || 0) >= 0 ? 1.12 : 1 / 1.12
      state.imageViewer.scale = clamp(Number(state.imageViewer.scale || 1) * factor, VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
      emitViewerShell()
    },
    imageSetScale: (scale: any) => {
      state.imageViewer.scale = clamp(Number(scale || 1), VIEWER_ZOOM_MIN, IMAGE_VIEWER_ZOOM_MAX)
      emitViewerShell()
    },
    imageReset: () => {
      state.imageViewer.scale = 1
      emitViewerShell()
    },
  }
}
