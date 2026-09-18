import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'

type EditingChatTitleState = { targetKind: 'role' | 'group' | 'workspace'; targetId: string; chatId: string; text: string }
type ConfirmDeleteChatState = { targetKind: 'role' | 'group' | 'workspace'; targetId: string; chatId: string }

export function ChatSessionDialogs(props: {
  controller: any
  loading: boolean
  editingChatTitle: EditingChatTitleState
  setEditingChatTitle: React.Dispatch<React.SetStateAction<EditingChatTitleState>>
  closeEditingChatTitle: () => void
  saveEditingChatTitle: () => void
  confirmDelChat: ConfirmDeleteChatState
  setConfirmDelChat: React.Dispatch<React.SetStateAction<ConfirmDeleteChatState>>
  isSendingThisChat: (targetKind: 'role' | 'group' | 'workspace', targetId: string, chatId: string) => boolean
}) {
  const {
    controller,
    loading,
    editingChatTitle,
    setEditingChatTitle,
    closeEditingChatTitle,
    saveEditingChatTitle,
    confirmDelChat,
    setConfirmDelChat,
    isSendingThisChat,
  } = props

  return (
    <>
      <Dialog open={!!editingChatTitle.chatId} onClose={closeEditingChatTitle} maxWidth="xs" fullWidth>
        <DialogTitle>编辑会话标题</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="标题"
            placeholder="例如：需求讨论 / bug 复盘 / …"
            value={String(editingChatTitle.text ?? '')}
            onChange={(e) => setEditingChatTitle((p) => ({ ...p, text: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeEditingChatTitle()
              if (e.key === 'Enter') {
                e.preventDefault()
                void saveEditingChatTitle()
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditingChatTitle}>取消</Button>
          <Button
            variant="contained"
            onClick={() => {
              void saveEditingChatTitle()
            }}
            disabled={!editingChatTitle.targetId || !editingChatTitle.chatId || loading}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!confirmDelChat.chatId}
        onClose={() => setConfirmDelChat({ targetKind: 'role', targetId: '', chatId: '' })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>确认删除这个会话？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            这会删除该会话下的全部消息记录，且不可恢复；同时会尝试删除该会话引用的本地图片文件（若其它会话仍引用则会保留）。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelChat({ targetKind: 'role', targetId: '', chatId: '' })}>取消</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              const { targetKind, targetId, chatId } = confirmDelChat
              setConfirmDelChat({ targetKind: 'role', targetId: '', chatId: '' })
              if (!targetId || !chatId) return
              if (targetKind === 'group') controller.actions.deleteGroupChat?.(targetId, chatId)
              else if (targetKind === 'workspace') controller.actions.deleteWorkspaceChat?.(targetId, chatId)
              else controller.actions.deleteChat?.(targetId, chatId)
            }}
            disabled={
              !confirmDelChat.targetId ||
              !confirmDelChat.chatId ||
              loading ||
              isSendingThisChat(confirmDelChat.targetKind, confirmDelChat.targetId, confirmDelChat.chatId)
            }
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
