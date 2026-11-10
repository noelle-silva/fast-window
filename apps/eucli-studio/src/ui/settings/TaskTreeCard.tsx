import * as React from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { MoreActionsMenu, type MoreActionsMenuItem } from '../components/MoreActionsMenu'

// 任务卡片：面上一行标题 + 复制键 + 更多菜单，整张卡可点进下一层。
// 标题同时也是键盘可达的按钮；复制与更多都在覆盖层之上，不会被整卡点击吃掉。

export function TaskTreeCard(props: {
  title: string
  description: string
  copied: boolean
  canCopy: boolean
  menuItems: MoreActionsMenuItem[]
  onOpen: () => void
  onCopy: () => void
}) {
  const { title, description, copied, canCopy, menuItems, onOpen, onCopy } = props

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

      {description ? (
        <Typography
          noWrap
          sx={{ fontSize: 12, lineHeight: '16px', color: 'var(--studio-text-tertiary)', pr: 10, width: '100%' }}
        >
          {description}
        </Typography>
      ) : null}

      <span style={{ position: 'absolute', top: 10, right: 44, zIndex: 1 }}>
        <IconButton
          aria-label="复制文本"
          size="small"
          disabled={!canCopy}
          onClick={onCopy}
          sx={{
            color: copied ? '#fff' : 'var(--studio-text-tertiary)',
            bgcolor: copied ? 'var(--studio-primary)' : 'transparent',
            '&:hover': { bgcolor: copied ? 'var(--studio-primary)' : 'var(--studio-field-hover)' },
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
