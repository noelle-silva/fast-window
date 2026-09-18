import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Popover, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RestartAltIcon from '@mui/icons-material/RestartAlt'

type MessageRole = 'user' | 'assistant'
type MessageMenuState = { mid: string; role: MessageRole; x: number; y: number }
type ConfirmMessageState = { mid: string; role: MessageRole }
type RegenState = { mid: string; role: MessageRole }

export function MessageMenusDialogs(props: {
  controller: any
  loading: boolean
  uiBusy: boolean
  msgMenu: MessageMenuState
  closeMsgMenu: () => void
  msgMenuIsToolResponse: boolean
  msgMenuMid: string
  msgMenuText: string
  copyMessageText: (text: unknown) => void
  toggleExpandedToolMsg: (mid: string) => void
  expandedToolMsgIds: Set<string>
  msgMenuCanEdit: boolean
  startEditMessage: (mid: string, text: string) => void
  messageMutationBlocked: (mid: any, operation?: any) => boolean
  msgMenuCanRegen: boolean
  msgMenuRegenMid: string
  msgMenuRegenRole: MessageRole
  setRegen: React.Dispatch<React.SetStateAction<RegenState>>
  regen: RegenState
  treeNodeMenu: MessageMenuState
  closeTreeNodeMenu: () => void
  confirmDelMsg: ConfirmMessageState
  setConfirmDelMsg: React.Dispatch<React.SetStateAction<ConfirmMessageState>>
  confirmDelTree: ConfirmMessageState
  setConfirmDelTree: React.Dispatch<React.SetStateAction<ConfirmMessageState>>
  regenPathParentMid: (mid: string, role: MessageRole) => string
  beginRunPathFollow: (parentMid: string) => any
}) {
  const {
    controller,
    loading,
    uiBusy,
    msgMenu,
    closeMsgMenu,
    msgMenuIsToolResponse,
    msgMenuMid,
    msgMenuText,
    copyMessageText,
    toggleExpandedToolMsg,
    expandedToolMsgIds,
    msgMenuCanEdit,
    startEditMessage,
    messageMutationBlocked,
    msgMenuCanRegen,
    msgMenuRegenMid,
    msgMenuRegenRole,
    setRegen,
    regen,
    treeNodeMenu,
    closeTreeNodeMenu,
    confirmDelMsg,
    setConfirmDelMsg,
    confirmDelTree,
    setConfirmDelTree,
    regenPathParentMid,
    beginRunPathFollow,
  } = props

  return (
    <>
      <Popover
        open={!!msgMenu.mid}
        onClose={closeMsgMenu}
        anchorReference="anchorPosition"
        anchorPosition={msgMenu.mid ? { top: msgMenu.y, left: msgMenu.x } : undefined}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 160, p: 0.5 }}>
          {msgMenuIsToolResponse ? (
            <>
              <MenuItem
                disabled={!msgMenuMid}
                onClick={() => {
                  const text = msgMenuText
                  closeMsgMenu()
                  copyMessageText(text)
                }}
                sx={{ gap: 1 }}
              >
                <ContentCopyIcon fontSize="small" />
                复制
              </MenuItem>

              <MenuItem
                disabled={!msgMenuMid}
                onClick={() => {
                  const mid = msgMenuMid
                  closeMsgMenu()
                  if (!mid) return
                  toggleExpandedToolMsg(mid)
                }}
                sx={{ gap: 1 }}
              >
                {msgMenuMid && expandedToolMsgIds.has(msgMenuMid) ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                {msgMenuMid && expandedToolMsgIds.has(msgMenuMid) ? '收起' : '展开'}
              </MenuItem>

              <MenuItem
                disabled={!msgMenuCanEdit}
                onClick={() => {
                  const mid = msgMenuMid
                  const text = msgMenuText
                  closeMsgMenu()
                  startEditMessage(mid, text)
                }}
                sx={{ gap: 1 }}
              >
                <EditOutlinedIcon fontSize="small" />
                编辑
              </MenuItem>

              <MenuItem
                disabled={!msgMenuMid || messageMutationBlocked(msgMenuMid, 'delete')}
                onClick={() => {
                  const mid = msgMenuMid
                  const role = msgMenu.role
                  closeMsgMenu()
                  setConfirmDelMsg({ mid, role })
                }}
                sx={{ gap: 1 }}
              >
                <DeleteOutlineIcon fontSize="small" />
                删除
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem
                disabled={!msgMenuMid || msgMenu.role !== 'assistant' || messageMutationBlocked(msgMenuMid, 'edit') || loading || uiBusy}
                onClick={() => {
                  const mid = msgMenuMid
                  closeMsgMenu()
                  if (!mid) return
                  controller.actions.createBranchFromAssistant?.(mid)
                }}
                sx={{ gap: 1 }}
              >
                <AddIcon fontSize="small" />
                新建分支
              </MenuItem>

              <MenuItem
                disabled={!msgMenuCanRegen}
                onClick={() => {
                  const mid = msgMenuRegenMid
                  const role = msgMenuRegenRole
                  closeMsgMenu()
                  if (!mid) return
                  setRegen({ mid, role })
                }}
                sx={{ gap: 1 }}
              >
                <RestartAltIcon fontSize="small" />
                重新回复
              </MenuItem>

              <MenuItem
                disabled={!msgMenuCanEdit}
                onClick={() => {
                  const mid = msgMenuMid
                  const text = msgMenuText
                  closeMsgMenu()
                  startEditMessage(mid, text)
                }}
                sx={{ gap: 1 }}
              >
                <EditOutlinedIcon fontSize="small" />
                编辑
              </MenuItem>

              <MenuItem
                disabled={!msgMenuMid}
                onClick={() => {
                  const text = msgMenuText
                  closeMsgMenu()
                  copyMessageText(text)
                }}
                sx={{ gap: 1 }}
              >
                <ContentCopyIcon fontSize="small" />
                复制
              </MenuItem>

              <MenuItem
                disabled={!msgMenuMid || messageMutationBlocked(msgMenuMid, 'delete')}
                onClick={() => {
                  const mid = msgMenuMid
                  const role = msgMenu.role
                  closeMsgMenu()
                  setConfirmDelMsg({ mid, role })
                }}
                sx={{ gap: 1 }}
              >
                <DeleteOutlineIcon fontSize="small" />
                删除
              </MenuItem>
            </>
          )}
        </Box>
      </Popover>

      <Popover
        open={!!treeNodeMenu.mid}
        onClose={closeTreeNodeMenu}
        anchorReference="anchorPosition"
        anchorPosition={treeNodeMenu.mid ? { top: treeNodeMenu.y, left: treeNodeMenu.x } : undefined}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ minWidth: 220, p: 0.5 }}>
          <MenuItem
            disabled={!treeNodeMenu.mid || messageMutationBlocked(treeNodeMenu.mid, 'delete')}
            onClick={() => {
              const mid = String(treeNodeMenu.mid || '').trim()
              const role = treeNodeMenu.role
              closeTreeNodeMenu()
              if (!mid) return
              setConfirmDelMsg({ mid, role })
            }}
            sx={{ gap: 1 }}
          >
            <DeleteOutlineIcon fontSize="small" />
            仅删除当前节点
          </MenuItem>

          <MenuItem
            disabled={!treeNodeMenu.mid || messageMutationBlocked(treeNodeMenu.mid, 'delete-subtree')}
            onClick={() => {
              const mid = String(treeNodeMenu.mid || '').trim()
              const role = treeNodeMenu.role
              closeTreeNodeMenu()
              if (!mid) return
              setConfirmDelTree({ mid, role })
            }}
            sx={{ gap: 1 }}
          >
            <DeleteOutlineIcon fontSize="small" />
            删除节点及子节点
          </MenuItem>
        </Box>
      </Popover>

      <Dialog
        open={!!confirmDelMsg.mid}
        onClose={() => setConfirmDelMsg({ mid: '', role: 'assistant' })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>确认删除这条消息？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            仅删除当前这条{confirmDelMsg.role === 'assistant' ? ' AI 回复' : '用户消息'}，不影响其他记录。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelMsg({ mid: '', role: 'assistant' })}>取消</Button>
          <Button
            variant="contained"
            color="error"
            onClick={async () => {
              const mid = confirmDelMsg.mid
              const ok = await Promise.resolve(controller.actions.deleteMessage?.(mid))
              if (ok === true) setConfirmDelMsg({ mid: '', role: 'assistant' })
            }}
            disabled={!confirmDelMsg.mid || messageMutationBlocked(confirmDelMsg.mid, 'delete')}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!confirmDelTree.mid}
        onClose={() => setConfirmDelTree({ mid: '', role: 'assistant' })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>确认删除该节点及其子节点？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            将删除该{confirmDelTree.role === 'assistant' ? ' AI 回复' : '用户消息'}节点，以及它后面所有分支上的子节点。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelTree({ mid: '', role: 'assistant' })}>取消</Button>
          <Button
            variant="contained"
            color="error"
            onClick={async () => {
              const mid = confirmDelTree.mid
              const ok = await Promise.resolve(controller.actions.deleteMessageSubtree?.(mid))
              if (ok === true) setConfirmDelTree({ mid: '', role: 'assistant' })
            }}
            disabled={!confirmDelTree.mid || messageMutationBlocked(confirmDelTree.mid, 'delete-subtree')}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!regen.mid}
        onClose={() => setRegen({ mid: '', role: 'assistant' })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>确认重新回复？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {regen.role === 'assistant' ? '这会基于该回复之前的上下文生成一个新的 AI 回复版本。' : '这会基于该用户消息生成一条新的 AI 回复。'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRegen({ mid: '', role: 'assistant' })}>取消</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              const mid = regen.mid
              const role = regen.role
              setRegen({ mid: '', role: 'assistant' })
              const parentMid = regenPathParentMid(mid, role)
              const follow = parentMid ? beginRunPathFollow(parentMid) : null
              Promise.resolve()
                .then(() => {
                  if (role === 'assistant') return controller.actions.regenerateAssistant?.(mid, follow ? { onRunState: follow.onRunState } : undefined)
                  return controller.actions.replyFromUserMessage?.(mid, follow ? { onRunState: follow.onRunState } : undefined)
                })
                .finally(() => follow?.clear())
            }}
            disabled={!regen.mid || loading || uiBusy}
          >
            重新回复
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
