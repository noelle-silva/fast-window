import * as React from 'react'
import { Box, Button, Stack, TextField } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import SaveIcon from '@mui/icons-material/Save'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { UNNAMED_TASK_LABEL, type TaskDraft } from '../../domain/taskTree'

// 当前节点的编辑位：名字 / 描述 / 可复制文本，加上这一层能做的全部动作。
// 只负责画与回调，脏判断、保存与结构动作由面板决定。

const FILLED_SECONDARY_SX = {
  bgcolor: 'var(--studio-field)',
  color: 'var(--studio-text-primary)',
  boxShadow: 'var(--studio-shadow-soft)',
  '&:hover': { bgcolor: 'var(--studio-field-hover)', boxShadow: 'var(--studio-shadow-soft)' },
}

export function TaskTreeEditor(props: {
  draft: TaskDraft | null
  label: string
  dirty: boolean
  saving: boolean
  canCopy: boolean
  hasChildren: boolean
  onDraftChange: (patch: Partial<TaskDraft>) => void
  onSave: () => void
  onCopy: () => void
  onMove: () => void
  onCreateChild: () => void
  onDelete: () => void
}) {
  const { draft, label, dirty, saving, canCopy, hasChildren, onDraftChange, onSave, onCopy, onMove, onCreateChild, onDelete } = props

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        p: 1.75,
        borderRadius: 3,
        bgcolor: 'var(--studio-paper)',
        boxShadow: 'var(--studio-shadow-soft)',
        minHeight: 0,
        overflowY: 'auto',
      }}
    >
      <TextField
        size="small"
        label="名字"
        placeholder={UNNAMED_TASK_LABEL}
        value={draft?.name ?? ''}
        onChange={(event) => onDraftChange({ name: event.target.value })}
      />
      <TextField
        size="small"
        label="描述"
        multiline
        minRows={2}
        value={draft?.description ?? ''}
        onChange={(event) => onDraftChange({ description: event.target.value })}
      />
      <TextField
        size="small"
        label="可复制文本"
        multiline
        minRows={6}
        value={draft?.content ?? ''}
        onChange={(event) => onDraftChange({ content: event.target.value })}
        sx={{ '& textarea': { minHeight: 120 } }}
      />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button size="small" variant="contained" disableElevation startIcon={<SaveIcon />} disabled={!dirty || saving} onClick={onSave}>
          保存
        </Button>
        <Button
          size="small"
          variant="contained"
          disableElevation
          startIcon={<ContentCopyIcon />}
          disabled={!canCopy}
          onClick={onCopy}
          sx={FILLED_SECONDARY_SX}
        >
          复制
        </Button>
        <Button
          size="small"
          variant="contained"
          disableElevation
          startIcon={<DriveFileMoveOutlinedIcon />}
          onClick={onMove}
          sx={FILLED_SECONDARY_SX}
        >
          移动
        </Button>
        <MoreActionsMenu
          ariaLabel="任务操作"
          items={[
            {
              key: 'create-child',
              label: '新建子任务',
              icon: <AddIcon fontSize="small" />,
              onSelect: onCreateChild,
            },
            {
              key: 'delete',
              label: '删除',
              danger: true,
              icon: <DeleteOutlineIcon fontSize="small" />,
              confirm: {
                title: `删除「${label}」？`,
                description: hasChildren ? '它的整棵子树会一起删除，删掉不可恢复。' : '删掉不可恢复。',
                confirmLabel: '删除',
              },
              onSelect: onDelete,
            },
          ]}
        />
      </Stack>
    </Box>
  )
}
