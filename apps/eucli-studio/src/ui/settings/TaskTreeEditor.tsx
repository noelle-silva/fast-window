import * as React from 'react'
import { Box, IconButton, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import SaveIcon from '@mui/icons-material/Save'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { FillTextarea } from '../components/FillTextarea'
import { UNNAMED_TASK_LABEL, type TaskDraft } from '../../domain/taskTree'

// 当前节点的编辑位：名字 / 描述 / 可复制文本，加上这一层能做的全部动作。
// 只负责画与回调，脏判断、保存与结构动作由面板决定。
//
// 保存、复制、移动到名字右侧，只占图标；
// 描述右侧是「复制高亮」开关：它只影响卡片上复制键的配色，是展示标记；
// 可复制文本吃满剩余高度并在框内自滚，外层不再整列滚动，滑块用项目自制的那一套。

const FILLED_SECONDARY_SX = {
  bgcolor: 'var(--studio-field)',
  color: 'var(--studio-text-primary)',
  boxShadow: 'var(--studio-shadow-soft)',
  '&:hover': { bgcolor: 'var(--studio-field-hover)', boxShadow: 'var(--studio-shadow-soft)' },
}

const PRIMARY_ICON_SX = {
  bgcolor: 'primary.main',
  color: '#fff',
  boxShadow: 'var(--studio-shadow-soft)',
  '&:hover': { bgcolor: 'primary.dark' },
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
      }}
    >
      {/* 名字与这一层的动作同一行：动作只留图标，把宽度让给名字。 */}
      <Stack direction="row" spacing={0.75} alignItems="center">
        <TextField
          size="small"
          label="名字"
          placeholder={UNNAMED_TASK_LABEL}
          value={draft?.name ?? ''}
          onChange={(event) => onDraftChange({ name: event.target.value })}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <IconButton
          size="small"
          aria-label="保存任务"
          disabled={!dirty || saving}
          onClick={onSave}
          sx={{ ...PRIMARY_ICON_SX, borderRadius: 1.5 }}
        >
          <SaveIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="复制任务文本"
          disabled={!canCopy}
          onClick={onCopy}
          sx={{ ...FILLED_SECONDARY_SX, borderRadius: 1.5 }}
        >
          <ContentCopyIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="移动任务"
          onClick={onMove}
          sx={{ ...FILLED_SECONDARY_SX, borderRadius: 1.5 }}
        >
          <DriveFileMoveOutlinedIcon fontSize="small" />
        </IconButton>
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

      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <TextField
          size="small"
          label="描述"
          multiline
          minRows={2}
          value={draft?.description ?? ''}
          onChange={(event) => onDraftChange({ description: event.target.value })}
          sx={{ flex: 1, minWidth: 0 }}
        />
        {/* 卡片墙上的复制键要不要用主题色标出来：只改外观，不动复制内容与复制行为。 */}
        <Tooltip title="开启后，卡片上的复制键用主题色标出">
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              width: 58,
              flexShrink: 0,
              pt: 0.25,
            }}
          >
            <Switch
              size="small"
              checked={Boolean(draft?.copyHighlight)}
              onChange={(event) => onDraftChange({ copyHighlight: event.target.checked })}
              slotProps={{ input: { 'aria-label': '复制键高亮' } }}
            />
            <Typography
              component="span"
              sx={{ fontSize: 11, lineHeight: '14px', color: 'var(--studio-text-tertiary)', whiteSpace: 'nowrap' }}
            >
              复制高亮
            </Typography>
          </Box>
        </Tooltip>
      </Stack>

      <FillTextarea
        label="可复制文本"
        value={draft?.content ?? ''}
        onChange={(next) => onDraftChange({ content: next })}
      />
    </Box>
  )
}
