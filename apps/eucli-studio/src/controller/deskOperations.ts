import { refreshScopes } from '../domain/uiRefreshScope'
import {
  addDeskRef,
  defaultDesks,
  moveDeskRef,
  normalizeDesks,
  removeDeskRef,
  removeDeskRefsByChatId,
  removeDeskRefsForTarget,
  type SessionDesks,
} from '../domain/desks'
import type { AiChatShowToast } from '../gateway/capabilities'

// 工作桌面的动作：与收藏夹同构——同一套「读当前数据 → 改 → 写回后端通道 → 发实体域通知」，
// 但数据是后端 sessions/desks.json 那一份，不是客户端偏好，也不与收藏夹混存。
export function createDeskOperations(deps: {
  getState: () => any
  save: () => Promise<void>
  emitScope: (scope: string) => void
  showToast?: AiChatShowToast
}) {
  const { getState, save, emitScope, showToast } = deps

  // 桌面是 entities:desks 域：清单变化只通知这个地址。
  function emitDesks() {
    emitScope(refreshScopes.entities('desks'))
  }

  function persistDesks() {
    save().catch((error: any) => showToast?.(String(error?.message || error || '保存工作桌面失败'), { kind: 'error' }))
  }

  function ensureDeskBare(): SessionDesks | null {
    const data = getState().data
    if (!data) return null
    data.desks = normalizeDesks(data.desks ?? defaultDesks())
    return data.desks
  }

  function writeDesks(next: SessionDesks) {
    const data = getState().data
    if (!data) return
    data.desks = next
    persistDesks()
    emitDesks()
  }

  return {
    addChatToDesk: (targetKind: any, targetId: any, roleId: any, chatId: any) => {
      const desks = ensureDeskBare()
      if (!desks) return false
      const result = addDeskRef(desks, { targetKind, targetId, roleId, chatId, addedAt: Date.now() })
      if (!result.added) {
        showToast?.('这个会话已经在工作桌面上了', { kind: 'info' })
        emitDesks()
        return false
      }
      writeDesks(result.desks)
      showToast?.('已添加到工作桌面', { kind: 'success' })
      return true
    },
    removeChatFromDesk: (targetKind: any, targetId: any, roleId: any, chatId: any) => {
      const desks = ensureDeskBare()
      if (!desks) return
      writeDesks(removeDeskRef(desks, { targetKind, targetId, roleId, chatId }))
    },
    moveDeskChat: (activeKey: any, overKey: any) => {
      const desks = ensureDeskBare()
      if (!desks) return
      writeDesks(moveDeskRef(desks, String(activeKey || ''), String(overKey || '')))
    },
    // 删除事实只带会话标识时走这里；带上完整标识时走 ForChat。
    cleanupDeskRefsByChatId: (chatId: any) => {
      const desks = ensureDeskBare()
      if (!desks) return
      const next = removeDeskRefsByChatId(desks, chatId)
      if (next.chatRefsByFolderId === desks.chatRefsByFolderId) return
      writeDesks(next)
    },
    cleanupDeskRefsForTarget: (targetKind: any, targetId: any) => {
      const desks = ensureDeskBare()
      if (!desks) return
      writeDesks(removeDeskRefsForTarget(desks, targetKind, targetId))
    },
  }
}
