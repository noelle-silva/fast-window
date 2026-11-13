import { refreshScopes } from '../domain/uiRefreshScope'
import {
  addDeskRef,
  collapseAllDeskGroups as collapseAllGroups,
  createDeskGroup as addDeskGroup,
  defaultDesks,
  dissolveDeskGroup as dissolveGroup,
  moveDeskUnit as moveDeskUnitInDesks,
  moveDeskUnitToGroupEnd as moveDeskUnitToGroupEndInDesks,
  normalizeDesks,
  removeDeskGroupWithChats as dropGroupWithChats,
  removeDeskRef,
  removeDeskRefsByChatId,
  removeDeskRefsForTarget,
  toggleDeskGroupCollapsed as toggleGroupCollapsed,
  updateDeskGroup as patchDeskGroup,
  type SessionDesks,
} from '../domain/desks'
import { findDeskDraftByPending, removeDeskDraft } from '../domain/deskDrafts'
import type { AiChatShowToast } from '../gateway/capabilities'

// 工作桌面的动作：与收藏夹同构——读当前数据 → 在副本上改 → 写回后端通道 → 成功才生效。
// 数据只有后端 sessions/desks.json 那一份；写失败一律不生效，界面不会凭空多出一条。
// 临时条目（Ctrl 新建会话产生的草稿）只活在客户端内存里，转正时按原位写进这份后端数据。
//
// 顺序相关的写操作只有一个入口：moveDeskUnit。
// 顶层换位、会话进出分组、组内换序，走的都是它。
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

  /**
   * 写回后端。
   *
   * optimistic 用于拖拽这类「手已经松开、画面必须立刻到位」的动作：
   * 先写内存再落盘，落盘失败连同界面一起回滚。
   * 其余动作仍然等落盘成功才生效，避免写失败时界面凭空多出一条。
   */
  async function commit(next: SessionDesks, okText?: string, options?: { optimistic?: boolean }): Promise<boolean> {
    const data = getState().data
    if (!data) return false
    const previous = data.desks
    if (options?.optimistic) {
      data.desks = next
      emitDesks()
    }
    try {
      await save(next)
    } catch (error: any) {
      if (options?.optimistic) {
        data.desks = previous
        emitDesks()
      }
      showToast?.(String(error?.message || error || '保存工作桌面失败'), { kind: 'error' })
      return false
    }
    if (!options?.optimistic) {
      data.desks = next
      emitDesks()
    }
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

    // ---- 顺序：唯一入口。顶层换位、进出分组、组内换序都是它。
    // 手一松开就得看到结果，所以这里走乐观落位：先改内存再落盘，失败回滚。
    moveDeskUnit: async (activeUnitId: any, overUnitId: any) => {
      const desks = currentDesks()
      if (!desks) return
      const next = moveDeskUnitInDesks(desks, String(activeUnitId || ''), String(overUnitId || ''))
      if (next === desks) return
      await commit(next, undefined, { optimistic: true })
    },

    // 放进某个分组的末尾。空分组没有成员可压，指针只能落在成员区那片空白上，靠这条接住。
    moveDeskUnitToGroupEnd: async (activeUnitId: any, groupId: any) => {
      const desks = currentDesks()
      if (!desks) return
      const next = moveDeskUnitToGroupEndInDesks(desks, String(activeUnitId || ''), String(groupId || ''))
      if (next === desks) return
      await commit(next, undefined, { optimistic: true })
    },

    // ---- 分组：新建 / 改名 / 换色 / 折叠 / 两种解散 ----
    createDeskGroup: async () => {
      const desks = currentDesks()
      if (!desks) return false
      return commit(addDeskGroup(desks))
    },
    renameDeskGroup: async (groupId: any, name: any) => {
      const desks = currentDesks()
      if (!desks) return false
      return commit(patchDeskGroup(desks, groupId, { name: String(name ?? '') }))
    },
    setDeskGroupColor: async (groupId: any, color: any) => {
      const desks = currentDesks()
      if (!desks) return false
      return commit(patchDeskGroup(desks, groupId, { color: String(color ?? '') }))
    },
    toggleDeskGroupCollapsed: async (groupId: any) => {
      const desks = currentDesks()
      if (!desks) return false
      return commit(toggleGroupCollapsed(desks, groupId))
    },
    // 一键收起：只写折叠标记；已经全部收起时不碰存储。
    collapseAllDeskGroups: async () => {
      const desks = currentDesks()
      if (!desks) return false
      const next = collapseAllGroups(desks)
      if (next === desks) return true
      return commit(next)
    },
    // 仅解散：组没了，成员留在桌面，摊平到组原来的位置。
    dissolveDeskGroup: async (groupId: any) => {
      const desks = currentDesks()
      if (!desks) return false
      return commit(dissolveGroup(desks, groupId))
    },
    // 连成员一起移出桌面。
    removeDeskGroupWithChats: async (groupId: any) => {
      const desks = currentDesks()
      if (!desks) return false
      return commit(dropGroupWithChats(desks, groupId))
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
