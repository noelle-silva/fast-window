import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'
import { useWorkspaceVisible } from './workspaceVisibility'

// 实体信息对话框：新建收藏夹与编辑信息共用一个表单，两种模式只换文案与按钮。
// 新建允许留空标题（由收藏夹文档统一回落到默认名），编辑要求标题非空。

export type EntityInfoDialogMode = 'create' | 'edit'

type Props = {
  open: boolean
  mode: EntityInfoDialogMode
  /** 初值：新建固定传空串，编辑传当前值。 */
  title: string
  description: string
  onClose: () => void
  onConfirm: (next: { title: string; description: string }) => void
}

export function EntityInfoDialog(props: Props): React.ReactNode {
  const { open, mode, title, description, onClose, onConfirm } = props
  const workspaceVisible = useWorkspaceVisible()
  const isCreate = mode === 'create'

  const [titleDraft, setTitleDraft] = React.useState(title)
  const [descriptionDraft, setDescriptionDraft] = React.useState(description)

  React.useEffect(() => {
    if (!open) return
    setTitleDraft(title)
    setDescriptionDraft(description)
  }, [open, title, description])

  const cannotSave = !isCreate && !String(titleDraft ?? '').trim()

  const confirm = React.useCallback(() => {
    if (cannotSave) return
    onConfirm({ title: titleDraft, description: descriptionDraft })
  }, [cannotSave, descriptionDraft, onConfirm, titleDraft])

  return (
    <Dialog open={workspaceVisible && open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isCreate ? '新建收藏夹' : '编辑信息'}</DialogTitle>
      <DialogContent>
        {isCreate ? (
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.55)', pb: 1 }}>会先创建一个真实收藏夹，再把它作为卡片放进当前页。</Typography>
        ) : null}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: isCreate ? 0 : 3 }}>
          <TextField
            fullWidth
            autoFocus
            label={isCreate ? '收藏夹标题' : '标题'}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            placeholder={isCreate ? '例如：项目灵感 / 临时收纳' : undefined}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                confirm()
              }
            }}
          />
          <TextField
            fullWidth
            multiline
            minRows={3}
            label={isCreate ? '收藏夹说明' : '说明'}
            value={descriptionDraft}
            onChange={e => setDescriptionDraft(e.target.value)}
            placeholder={isCreate ? '写一点这个收藏夹用来收纳什么' : '补充一点说明'}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={cannotSave} onClick={confirm}>
          {isCreate ? '创建并添加' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
