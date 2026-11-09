// 工作桌面动作的对外出口：与 favoriteActions 同构的一层薄包装，
// 数据仍由 deskOperations 读写后端那一份。
export function createDeskActions(deps: { deskOps: any }) {
  const { deskOps } = deps

  return {
    addChatToDesk: (targetKind: any, targetId: any, roleId: any, chatId: any) =>
      deskOps.addChatToDesk(targetKind, targetId, roleId, chatId),
    removeChatFromDesk: (targetKind: any, targetId: any, roleId: any, chatId: any) =>
      deskOps.removeChatFromDesk(targetKind, targetId, roleId, chatId),
    moveDeskChat: (activeKey: any, overKey: any) => deskOps.moveDeskChat(activeKey, overKey),
  }
}
