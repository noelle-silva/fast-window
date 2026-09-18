export function createFavoriteActions(deps: {
  favOps: any
}) {
  const { favOps } = deps

  return {
    createFavoriteFolder: (name: any, parentId: any) => favOps.createFavoriteFolder(name, parentId),
    renameFavoriteFolder: (folderId: any, name: any) => favOps.renameFavoriteFolder(folderId, name),
    deleteFavoriteFolderKeepContents: (folderId: any, targetFolderId: any) => favOps.deleteFavoriteFolderKeepContents(folderId, targetFolderId),
    deleteFavoriteFolderTree: (folderId: any) => favOps.deleteFavoriteFolderTree(folderId),
    clearFavoriteFolderRefs: (folderId: any) => favOps.clearFavoriteFolderRefs(folderId),
    moveFavoriteFolder: (folderId: any, nextParentId: any) => favOps.moveFavoriteFolder(folderId, nextParentId),
    setChatFavoriteFolders: (targetKind: any, targetId: any, chatId: any, folderIds: any) => favOps.setChatFavoriteFolders(targetKind, targetId, chatId, folderIds),
    getChatFavoriteFolderIds: (targetKind: any, targetId: any, chatId: any) => favOps.getFavoriteFolderIdsForChat(targetKind, targetId, chatId),
  }
}
