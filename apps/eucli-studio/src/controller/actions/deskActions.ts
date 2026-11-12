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

    // 顺序：唯一入口。顶层换位、会话进出分组、组内换序都走它。
    moveDeskUnit: (activeUnitId: any, overUnitId: any) => deskOps.moveDeskUnit(activeUnitId, overUnitId),
    // 放进某个分组的末尾：空分组没有成员可压，需要这条单独的路径。
    moveDeskUnitToGroupEnd: (activeUnitId: any, groupId: any) =>
      deskOps.moveDeskUnitToGroupEnd(activeUnitId, groupId),

    // 分组：新建 / 改名 / 换色 / 折叠 / 两种解散。
    createDeskGroup: () => deskOps.createDeskGroup(),
    renameDeskGroup: (groupId: any, name: any) => deskOps.renameDeskGroup(groupId, name),
    setDeskGroupColor: (groupId: any, color: any) => deskOps.setDeskGroupColor(groupId, color),
    toggleDeskGroupCollapsed: (groupId: any) => deskOps.toggleDeskGroupCollapsed(groupId),
    dissolveDeskGroup: (groupId: any) => deskOps.dissolveDeskGroup(groupId),
    removeDeskGroupWithChats: (groupId: any) => deskOps.removeDeskGroupWithChats(groupId),
  }
}
