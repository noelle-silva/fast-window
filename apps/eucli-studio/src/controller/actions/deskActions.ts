import type { AiChatShowToast } from '../../gateway/capabilities'
import { refreshScopes } from '../../domain/uiRefreshScope'
import {
  DESK_SETTING_KEY,
  moveDeskChatRef,
  normalizeDesk,
  normalizeDeskHoverRoleIcon,
  removeDeskChatRef,
  removeDeskRefsByChatId,
  removeDeskRefsForChat,
  removeDeskRefsForTarget,
  upsertDeskChatRef,
} from '../../domain/desk'

// 工作桌面的动作：增删 / 排序 / 悬停图标开关都只改 settings.desk 这一份事实，并走偏好通道落盘。
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

  // 读取当前桌面（引用清单 + 开关），顺手把归一化结果写回，保证结构稳定。
  function currentDesk() {
    if (!state.data) return null
    if (!state.data.settings || typeof state.data.settings !== 'object') state.data.settings = {}
    const box = state.data.settings
    const desk = normalizeDesk(box[DESK_SETTING_KEY])
    box[DESK_SETTING_KEY] = desk
    return desk
  }

  function writeDesk(next: { refs: any[]; hoverShowsRoleIcon: boolean }) {
    if (!state.data) return
    ;(state.data.settings as any)[DESK_SETTING_KEY] = next
    persistMeta()
    notifySettings()
  }

  function writeRefs(refs: any[]) {
    const desk = currentDesk()
    if (!desk) return
    writeDesk({ ...desk, refs })
  }

  return {
    // 添加到桌面末尾；已经在桌上就只提示，不改顺序。
    addChatToDesk: (targetKind: any, targetId: any, roleId: any, chatId: any) => {
      const desk = currentDesk()
      if (!desk) return false
      const next = upsertDeskChatRef(desk.refs, { targetKind, targetId, roleId, chatId })
      if (next.length === desk.refs.length) {
        showToast?.('这个会话已经在工作桌面上了', { kind: 'info' })
        notifySettings()
        return false
      }
      writeDesk({ ...desk, refs: next })
      return true
    },
    removeChatFromDesk: (targetKind: any, targetId: any, roleId: any, chatId: any) => {
      writeRefs(removeDeskChatRef(currentDesk()?.refs || [], { targetKind, targetId, roleId, chatId }))
    },
    moveDeskChat: (activeKey: any, overKey: any) => {
      writeRefs(moveDeskChatRef(currentDesk()?.refs || [], String(activeKey || ''), String(overKey || '')))
    },
    // 悬停时把工作区条目的图标换成所属角色图标；关掉就一直是工作区自己的图标。
    setDeskHoverRoleIcon: (enabled: any) => {
      const desk = currentDesk()
      if (!desk) return
      writeDesk({ ...desk, hoverShowsRoleIcon: normalizeDeskHoverRoleIcon(enabled) })
    },
    // 会话被删除 / 目标被删除时的清理入口，避免桌面留下指向空的引用。
    cleanupDeskRefsForChat: (targetKind: any, targetId: any, roleId: any, chatId: any) => {
      const desk = currentDesk()
      if (!desk) return
      const next = removeDeskRefsForChat(desk.refs, targetKind, targetId, roleId, chatId)
      if (next.length === desk.refs.length) return
      writeDesk({ ...desk, refs: next })
    },
    // 删除事实只带 kind / targetId / chatId 时走这里，按会话标识摘除。
    cleanupDeskRefsByChatId: (chatId: any) => {
      const desk = currentDesk()
      if (!desk) return
      const next = removeDeskRefsByChatId(desk.refs, chatId)
      if (next.length === desk.refs.length) return
      writeDesk({ ...desk, refs: next })
    },
    cleanupDeskRefsForTarget: (targetKind: any, targetId: any) => {
      const desk = currentDesk()
      if (!desk) return
      const next = removeDeskRefsForTarget(desk.refs, targetKind, targetId)
      if (next.length === desk.refs.length) return
      writeDesk({ ...desk, refs: next })
    },
  }
}
