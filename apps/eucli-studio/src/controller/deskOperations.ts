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
import { findDeskDraftByPending, removeDeskDraft } from '../domain/deskDrafts'
import type { AiChatShowToast } from '../gateway/capabilities'

// 工作桌面的动作：与收藏夹同构——读当前数据 → 在副本上改 → 写回后端通道 → 成功才生效。
// 数据只有后端 sessions/desks.json 那一份；写失败一律不生效，界面不会凭空多出一条。
// 临时条目（Ctrl 新建会话产生的草稿）只活在客户端内存里，转正时按原位写进这份后端数据。
export function createDeskOperations(deps: {
  getState: () => any
  save: (desks?: any) => Promise<void>
  emitScope: (scope: string) => void
  showToast?: AiChatShowToast
}) {
  const { getState, save, emitScope, showToast } = deps

  // 桌面是 entities:desks 域：清单变化只通知这个地址。
  function emitDesks() {
    emitScope(refreshScopes.entities('desks'))
  }

  function currentDesks(): SessionDesks | null {
    const data = getState().data
    if (!data) return null
    return normalizeDesks(data.desks ?? defaultDesks())
  }

  // 先落后端，写成功才把结果写回内存并通知；失败保持原样，只在提示里说明。
  async function commit(next: SessionDesks, okText?: string): Promise<boolean> {
    const data = getState().data
    if (!data) return false
    try {
      await save(next)
    } catch (error: any) {
      showToast?.(String(error?.message || error || '保存工作桌面失败'), { kind: 'error' })
      return false
    }
    data.desks = next
    emitDesks()
    if (okText) showToast?.(okText, { kind: 'success' })
    return true
  }

  return {
    addChatToDesk: async (targetKind: any, targetId: any, roleId: any, chatId: any, index?: any) => {
      const desks = currentDesks()
      if (!desks) return false
      const result = addDeskRef(
        desks,
        { targetKind, targetId, roleId, chatId, addedAt: Date.now() },
        typeof index === 'number' ? index : undefined,
      )
      if (!result.added) {
        showToast?.('这个会话已经在工作桌面上了', { kind: 'info' })
        return false
      }
      return commit(result.desks, '已添加到工作桌面')
    },
    removeChatFromDesk: async (targetKind: any, targetId: any, roleId: any, chatId: any) => {
      const desks = currentDesks()
      if (!desks) return
      await commit(removeDeskRef(desks, { targetKind, targetId, roleId, chatId }))
    },
    moveDeskChat: async (activeKey: any, overKey: any) => {
      const desks = currentDesks()
      if (!desks) return
      await commit(moveDeskRef(desks, String(activeKey || ''), String(overKey || '')))
    },
    // 临时条目转正：草稿会话真实建立、拿到 chatId 后调用。
    // 按草稿当初占的位置插回桌面；写入成功后把内存草稿摘掉。
    promoteDeskDraft: async (pendingChatId: any, chatId: any) => {
      const draft = findDeskDraftByPending(pendingChatId)
      if (!draft) return false
      const cid = String(chatId || '').trim()
      if (!cid) return false
      const desks = currentDesks()
      if (!desks) return false
      const result = addDeskRef(
        desks,
        {
          targetKind: draft.targetKind,
          targetId: draft.targetId,
          roleId: draft.roleId,
          chatId: cid,
          addedAt: draft.addedAt,
        },
        draft.order,
      )
      const ok = result.added ? await commit(result.desks) : true
      if (!ok) return false
      removeDeskDraft(pendingChatId)
      emitDesks()
      return true
    },
    // 删除事实只带会话标识时走这里。
    cleanupDeskRefsByChatId: async (chatId: any) => {
      const desks = currentDesks()
      if (!desks) return
      await commit(removeDeskRefsByChatId(desks, chatId))
    },
    cleanupDeskRefsForTarget: async (targetKind: any, targetId: any) => {
      const desks = currentDesks()
      if (!desks) return
      await commit(removeDeskRefsForTarget(desks, targetKind, targetId))
    },
  }
}
