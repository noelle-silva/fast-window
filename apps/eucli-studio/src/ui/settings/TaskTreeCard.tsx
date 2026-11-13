import * as React from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { MoreActionsMenu, type MoreActionsMenuItem } from '../components/MoreActionsMenu'
import { colorMixVar } from '../colorThemeStyles'
import { TaskStatusBadge } from './TaskStatusBadge'
import type { TaskStatus } from '../../domain/taskTree'

// 任务卡片：面上一行标题 + 复制键 + 更多菜单，整张卡可点进下一层。
// 标题同时也是键盘可达的按钮；复制与更多都在覆盖层之上，不会被整卡点击吃掉。
// 复制键的常态配色由节点的「复制高亮」标记决定：开启后与主题色同色系，
// 复制成功那一刻再用实心主题色回应，两种状态不打架。
// 右下角是进度标签（未开始 / 进行中 / 已完成）；归档任务不会出现在卡片墙上。

export function TaskTreeCard(props: {
  title: string
  description: string
  /** 归档页里显示祖先路径：扁平列表下用它区分不同层级的同名任务。 */
  trail?: string
  /** 复制键用主题色标出：来自编辑位里「复制高亮」开关。 */
  copyHighlight: boolean
  /** 进度状态：决定右下角标签的文案与配色。 */
  status: TaskStatus
  copied: boolean
  canCopy: boolean
  menuItems: MoreActionsMenuItem[]
  onOpen: () => void
  onCopy: () => void
}) {
  const { title, description, trail = '', copyHighlight, status, copied, canCopy, menuItems, onOpen, onCopy } = props
  // 没有可复制内容时复制键本来按不动，不必再强调一个点不动的按钮。
  const highlighted = copyHighlight && canCopy

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 0.5,
        minHeight: 132,
        p: 2,
        borderRadius: 1.5,
        bgcolor: 'var(--studio-paper)',
        boxShadow: 'var(--studio-shadow-soft)',
        transition: 'transform .22s cubic-bezier(.2,.8,.3,1), box-shadow .22s cubic-bezier(.2,.8,.3,1)',
        // hover 用紧凑阴影：模糊半径压到 24，扩散范围落在列表容器的内边距里，
        // 不会再被滚动容器从左、上两边裁断；上浮也收小到 2px。
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 10px 24px color-mix(in srgb, var(--studio-text-primary) 12%, transparent)',
        },
        '&:active': { transform: 'translateY(-1px)' },
      }}
    >
      <Typography
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpen()
        }}
        sx={{
          fontSize: 15.5,
          fontWeight: 700,
          letterSpacing: '-0.005em',
          color: 'var(--studio-text-primary)',
          cursor: 'pointer',
          pr: 10,
          width: '100%',
          wordBreak: 'break-word',
          '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 1.5 },
        }}
      >
        {title}
      </Typography>

      {trail ? (
        <Typography
          noWrap
          sx={{ fontSize: 11, lineHeight: '15px', color: 'var(--studio-text-tertiary)', pr: 10, width: '100%' }}
        >
          {trail}
        </Typography>
      ) : null}

      {description ? (
        <Typography
          noWrap
          sx={{ fontSize: 12, lineHeight: '16px', color: 'var(--studio-text-tertiary)', pr: 10, width: '100%' }}
        >
          {description}
        </Typography>
      ) : null}

      {/* 进度标签压在卡片右下角：内容少时靠 auto 外边距贴底，不挤占标题与描述。 */}
      <Box sx={{ marginTop: 'auto', alignSelf: 'flex-end', pt: 1 }}>
        <TaskStatusBadge status={status} />
      </Box>

      <span style={{ position: 'absolute', top: 10, right: 44, zIndex: 1 }}>
        <IconButton
          aria-label="复制文本"
          size="small"
          disabled={!canCopy}
          onClick={onCopy}
          sx={{
            color: copied ? '#fff' : highlighted ? 'var(--studio-primary)' : 'var(--studio-text-tertiary)',
            bgcolor: copied
              ? 'var(--studio-primary)'
              : highlighted
                ? 'var(--studio-primary-soft)'
                : 'transparent',
            '&:hover': {
              bgcolor: copied
                ? 'var(--studio-primary)'
                : highlighted
                  ? colorMixVar('--studio-primary', 20)
                  : 'var(--studio-field-hover)',
            },
          }}
        >
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </span>

      <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>
        <MoreActionsMenu items={menuItems} ariaLabel="任务操作" />
      </Box>
    </Box>
  )
}
