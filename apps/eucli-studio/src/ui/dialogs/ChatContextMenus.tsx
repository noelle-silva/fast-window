import * as React from 'react'
import { Box, MenuItem, Popover } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded'

type TargetKind = 'role' | 'group' | 'workspace'

export function ChatContextMenus(props: {
  controller: any
  loading: boolean
  favoriteFolderMenu: { folderId: string; parentId: string; x: number; y: number }
  closeFavoriteFolderMenu: () => void
  openCreateFavoriteFolder: (parentId?: string) => void
  setMoveFavoriteFolderDialog: React.Dispatch<React.SetStateAction<{ open: boolean; folderId: string; parentId: string }>>
  openRenameFavoriteFolder: (folderId: string) => void
  setConfirmClearFavoriteFolder: React.Dispatch<React.SetStateAction<{ open: boolean; folderId: string }>>
  openDeleteFavoriteFolderConfirm: (folderId: string, mode: 'keep' | 'tree') => void
  favoriteChatMenu: { folderId: string; targetKind: TargetKind; targetId: string; chatId: string; title: string; x: number; y: number }
  closeFavoriteChatMenu: () => void
  openFavoriteDialog: (targetKind: TargetKind, targetId: string, chatId: string, title: string) => void
  setEditingChatTitle: React.Dispatch<React.SetStateAction<{ targetKind: TargetKind; targetId: string; chatId: string; text: string }>>
  isSendingThisChat: (targetKind: TargetKind, targetId: string, chatId: string) => boolean
  chatMenu: { targetKind: TargetKind; targetId: string; chatId: string; title: string; x: number; y: number }
  closeChatMenu: () => void
  setConfirmDelChat: React.Dispatch<React.SetStateAction<{ targetKind: TargetKind; targetId: string; chatId: string }>>
}) {
  const {
    controller,
    loading,
    favoriteFolderMenu,
    closeFavoriteFolderMenu,
    openCreateFavoriteFolder,
    setMoveFavoriteFolderDialog,
    openRenameFavoriteFolder,
    setConfirmClearFavoriteFolder,
    openDeleteFavoriteFolderConfirm,
    favoriteChatMenu,
    closeFavoriteChatMenu,
    openFavoriteDialog,
    setEditingChatTitle,
    isSendingThisChat,
    chatMenu,
    closeChatMenu,
    setConfirmDelChat,
  } = props

  return (
    <>
      <Popover
        open={!!favoriteFolderMenu.folderId}
        onClose={closeFavoriteFolderMenu}
        anchorReference="anchorPosition"
        anchorPosition={favoriteFolderMenu.folderId ? { top: favoriteFolderMenu.y, left: favoriteFolderMenu.x } : undefined}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 220, p: 0.5 }}>
          <MenuItem
            onClick={() => {
              const fid = String(favoriteFolderMenu.folderId || '')
              if (!fid) return
              openCreateFavoriteFolder(fid)
              closeFavoriteFolderMenu()
            }}
            sx={{ gap: 1 }}
          >
            <AddIcon fontSize="small" />
            新建子文件夹
          </MenuItem>
          <MenuItem
            onClick={() => {
              openCreateFavoriteFolder(String(favoriteFolderMenu.parentId || ''))
              closeFavoriteFolderMenu()
            }}
            sx={{ gap: 1 }}
          >
            <AddIcon fontSize="small" />
            新建同级文件夹
          </MenuItem>
          <MenuItem
            onClick={() => {
              const fid = String(favoriteFolderMenu.folderId || '')
              if (!fid) return
              closeFavoriteFolderMenu()
              setMoveFavoriteFolderDialog({ open: true, folderId: fid, parentId: String(favoriteFolderMenu.parentId || '') })
            }}
            sx={{ gap: 1 }}
          >
            <DriveFileMoveOutlinedIcon fontSize="small" />
            移动到...
          </MenuItem>
          <MenuItem onClick={() => openRenameFavoriteFolder(favoriteFolderMenu.folderId)} sx={{ gap: 1 }}>
            <EditOutlinedIcon fontSize="small" />
            重命名
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeFavoriteFolderMenu()
              setConfirmClearFavoriteFolder({ open: true, folderId: String(favoriteFolderMenu.folderId || '') })
            }}
            sx={{ gap: 1 }}
          >
            <DeleteOutlineIcon fontSize="small" />
            清空当前文件夹收藏
          </MenuItem>
          <MenuItem onClick={() => openDeleteFavoriteFolderConfirm(favoriteFolderMenu.folderId, 'keep')} sx={{ gap: 1 }}>
            <DeleteOutlineIcon fontSize="small" />
            删除文件夹（内容保留）
          </MenuItem>
          <MenuItem onClick={() => openDeleteFavoriteFolderConfirm(favoriteFolderMenu.folderId, 'tree')} sx={{ gap: 1 }}>
            <DeleteOutlineIcon fontSize="small" />
            删除文件夹及其子内容
          </MenuItem>
        </Box>
      </Popover>

      <Popover
        open={!!favoriteChatMenu.chatId}
        onClose={closeFavoriteChatMenu}
        anchorReference="anchorPosition"
        anchorPosition={favoriteChatMenu.chatId ? { top: favoriteChatMenu.y, left: favoriteChatMenu.x } : undefined}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 200, p: 0.5 }}>
          <MenuItem
            disabled={!favoriteChatMenu.chatId || !favoriteChatMenu.targetId || loading}
            onClick={() => {
              const { targetKind, targetId, chatId, title } = favoriteChatMenu
              closeFavoriteChatMenu()
              openFavoriteDialog(targetKind, targetId, chatId, title)
            }}
            sx={{ gap: 1 }}
          >
            <StarBorderRoundedIcon fontSize="small" />
            收藏到...
          </MenuItem>
          <MenuItem
            disabled={!favoriteChatMenu.chatId || !favoriteChatMenu.targetId || !favoriteChatMenu.folderId || loading}
            onClick={() => {
              const { folderId, targetKind, targetId, chatId } = favoriteChatMenu
              const currentIds = Array.isArray(controller.actions.getChatFavoriteFolderIds?.(targetKind, targetId, chatId))
                ? controller.actions.getChatFavoriteFolderIds(targetKind, targetId, chatId)
                : []
              closeFavoriteChatMenu()
              controller.actions.setChatFavoriteFolders?.(
                targetKind,
                targetId,
                chatId,
                currentIds.filter((id: any) => String(id || '') !== String(folderId || '')),
              )
            }}
            sx={{ gap: 1 }}
          >
            <DeleteOutlineIcon fontSize="small" />
            从当前文件夹移除
          </MenuItem>
          <MenuItem
            disabled={!favoriteChatMenu.chatId || !favoriteChatMenu.targetId || loading}
            onClick={() => {
              const { targetKind, targetId, chatId, title } = favoriteChatMenu
              closeFavoriteChatMenu()
              setEditingChatTitle({ targetKind, targetId, chatId, text: String(title ?? '') })
            }}
            sx={{ gap: 1 }}
          >
            <EditOutlinedIcon fontSize="small" />
            编辑标题
          </MenuItem>
          <MenuItem
            disabled={
              !favoriteChatMenu.chatId ||
              !favoriteChatMenu.targetId ||
              loading ||
              isSendingThisChat(favoriteChatMenu.targetKind, favoriteChatMenu.targetId, favoriteChatMenu.chatId)
            }
            onClick={() => {
              const { targetKind, targetId, chatId } = favoriteChatMenu
              closeFavoriteChatMenu()
              Promise.resolve()
                .then(() => {
                  if (targetKind === 'group') return controller.actions.aiGenerateGroupChatTitle?.(targetId, chatId)
                  if (targetKind === 'workspace') return controller.actions.aiGenerateWorkspaceChatTitle?.(targetId, chatId)
                  return controller.actions.aiGenerateChatTitle?.(targetId, chatId)
                })
                .catch(() => {})
            }}
            sx={{ gap: 1 }}
          >
            <AutorenewIcon fontSize="small" />
            AI 生成标题
          </MenuItem>
        </Box>
      </Popover>

      <Popover
        open={!!chatMenu.chatId}
        onClose={closeChatMenu}
        anchorReference="anchorPosition"
        anchorPosition={chatMenu.chatId ? { top: chatMenu.y, left: chatMenu.x } : undefined}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 180, p: 0.5 }}>
          <MenuItem
            disabled={!chatMenu.chatId || !chatMenu.targetId || loading}
            onClick={() => {
              const { targetKind, targetId, chatId, title } = chatMenu
              closeChatMenu()
              setEditingChatTitle({ targetKind, targetId, chatId, text: String(title ?? '') })
            }}
            sx={{ gap: 1 }}
          >
            <EditOutlinedIcon fontSize="small" />
            编辑标题
          </MenuItem>
          <MenuItem
            disabled={!chatMenu.chatId || !chatMenu.targetId || loading || isSendingThisChat(chatMenu.targetKind, chatMenu.targetId, chatMenu.chatId)}
            onClick={() => {
              const { targetKind, targetId, chatId } = chatMenu
              closeChatMenu()
              Promise.resolve()
                .then(() => {
                  if (targetKind === 'group') return controller.actions.aiGenerateGroupChatTitle?.(targetId, chatId)
                  if (targetKind === 'workspace') return controller.actions.aiGenerateWorkspaceChatTitle?.(targetId, chatId)
                  return controller.actions.aiGenerateChatTitle?.(targetId, chatId)
                })
                .catch(() => {})
            }}
            sx={{ gap: 1 }}
          >
            <AutorenewIcon fontSize="small" />
            AI 生成标题
          </MenuItem>
          <MenuItem
            disabled={!chatMenu.chatId || !chatMenu.targetId || loading}
            onClick={() => {
              const { targetKind, targetId, chatId, title } = chatMenu
              closeChatMenu()
              openFavoriteDialog(targetKind, targetId, chatId, title)
            }}
            sx={{ gap: 1 }}
          >
            <StarBorderRoundedIcon fontSize="small" />
            收藏到...
          </MenuItem>
          <MenuItem
            disabled={!chatMenu.chatId || !chatMenu.targetId || loading || isSendingThisChat(chatMenu.targetKind, chatMenu.targetId, chatMenu.chatId)}
            onClick={() => {
              const { targetKind, targetId, chatId } = chatMenu
              closeChatMenu()
              setConfirmDelChat({ targetKind, targetId, chatId })
            }}
            sx={{ gap: 1 }}
          >
            <DeleteOutlineIcon fontSize="small" />
            删除
          </MenuItem>
        </Box>
      </Popover>
    </>
  )
}
