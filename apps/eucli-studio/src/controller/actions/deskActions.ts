import type { AiChatShowToast } from '../../gateway/capabilities'
import { refreshScopes } from '../../domain/uiRefreshScope'
import {
  DESK_SETTING_KEY,
  moveDeskChatRef,
  normalizeDesk,
  removeDeskChatRef,
  removeDeskRefsByChatId,
  removeDeskRefsForChat,
  removeDeskRefsForTarget,
  upsertDeskChatRef,
} from '../../domain/desk'

// 工作桌面的动作：增删 / 排序都只改 settings.desk 这一份事实，并走偏好通道落盘。
// 桌面与会话本体完全解耦：这里从不写会话，也不读会话正文。
export function createDeskActions(deps: {
  state: any
  emitScope: (scope: string) => void
  saveMeta: () => Promise<any>
  showToast?: AiChatShowToast
}) {
  const { state, emitScope, saveMeta, showToast } = deps

  // 桌面属于设置域：只发设置地址，不做全局广播。
  function notifySettings() {
    emitScope(refreshScopes.settings())
  }

  function persistMeta() {
    void saveMeta().catch((error: any) => {
      showToast?.(String(error?.message || error || '保存工作桌面失败'), { kind: 'error' })
    })
  }

  function currentRefs() {
    if (!state.data) return []
    if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {}
    const box = state.data.settings
    const desk = normalizeDesk(box[DESK_SETTING_KEY])
    box[DESK_SETTING_KEY] = desk
    return desk.refs
  }

  function writeRefs(refs: any[]) {
    if (!state.data) return
    ;(state.data.settings as any)[DESK_SETTING_KEY] = { refs }
    persistMeta()
    notifySettings()
  }

  return {
    // 添加到桌面末尾；已经在桌上就只提示，不改顺序。
    addChatToDesk: (targetKind: any, targetId: any, roleId: any, chatId: any) => {
      const refs = currentRefs()
      const next = upsertDeskChatRef(refs, { targetKind, targetId, roleId, chatId })
      if (next.length === refs.length) {
        showToast?.('这个会话已经在工作桌面上了', { kind: 'info' })
        notifySettings()
        return false
      }
      writeRefs(next)
      return true
    },
    removeChatFromDesk: (targetKind: any, targetId: any, roleId: any, chatId: any) => {
      writeRefs(removeDeskChatRef(currentRefs(), { targetKind, targetId, roleId, chatId }))
    },
    moveDeskChat: (activeKey: any, overKey: any) => {
      writeRefs(moveDeskChatRef(currentRefs(), String(activeKey || ''), String(overKey || '')))
    },
    // 会话被删除 / 目标被删除时的清理入口，避免桌面留下指向空的引用。
    cleanupDeskRefsForChat: (targetKind: any, targetId: any, roleId: any, chatId: any) => {
      if (!state.data) return
      const refs = currentRefs()
      const next = removeDeskRefsForChat(refs, targetKind, targetId, roleId, chatId)
      if (next.length === refs.length) return
      writeRefs(next)
    },
    // 删除事实只带 kind / targetId / chatId 时走这里，按会话标识摘除。
    cleanupDeskRefsByChatId: (chatId: any) => {
      if (!state.data) return
      const refs = currentRefs()
      const next = removeDeskRefsByChatId(refs, chatId)
      if (next.length === refs.length) return
      writeRefs(next)
    },
    cleanupDeskRefsForTarget: (targetKind: any, targetId: any) => {
      if (!state.data) return
      const refs = currentRefs()
      const next = removeDeskRefsForTarget(refs, targetKind, targetId)
      if (next.length === refs.length) return
      writeRefs(next)
    },
  }
}
