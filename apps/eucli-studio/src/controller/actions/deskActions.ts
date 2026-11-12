// 工作桌面动作的对外出口：与 favoriteActions 同构的一层薄包装，
// 数据仍由 deskOperations 读写后端那一份。
export function createDeskActions(deps: { deskOps: any }) {
  const { deskOps } = deps

  return {
    addChatToDesk: (targetKind: any, targetId: any, roleId: any, chatId: any, index?: any) =>
      deskOps.addChatToDesk(targetKind, targetId, roleId, chatId, index),
    promoteDeskDraft: (pendingChatId: any, chatId: any) => deskOps.promoteDeskDraft(pendingChatId, chatId),
    removeChatFromDesk: (targetKind: any, targetId: any, roleId: any, chatId: any) =>
      deskOps.removeChatFromDesk(targetKind, targetId, roleId, chatId),
    moveDeskChat: (activeKey: any, overKey: any) => deskOps.moveDeskChat(activeKey, overKey),

    // 分组：新建 / 改名 / 换色 / 删除 / 与会话混排换位。
    createDeskGroup: () => deskOps.createDeskGroup(),
    renameDeskGroup: (groupId: any, name: any) => deskOps.renameDeskGroup(groupId, name),
    setDeskGroupColor: (groupId: any, color: any) => deskOps.setDeskGroupColor(groupId, color),
    removeDeskGroup: (groupId: any) => deskOps.removeDeskGroup(groupId),
    moveDeskItem: (activeRowId: any, overRowId: any) => deskOps.moveDeskItem(activeRowId, overRowId),
  }
}
