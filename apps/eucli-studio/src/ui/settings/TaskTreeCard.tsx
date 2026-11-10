import * as React from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { MoreActionsMenu, type MoreActionsMenuItem } from '../components/MoreActionsMenu'

// 任务卡片：面上一行标题 + 复制键 + 更多菜单，整张卡可点进下一层。
// 标题同时也是键盘可达的按钮；复制与更多都在覆盖层之上，不会被整卡点击吃掉。

export function TaskTreeCard(props: {
  title: string
  copied: boolean
  canCopy: boolean
  menuItems: MoreActionsMenuItem[]
  onOpen: () => void
  onCopy: () => void
}) {
  const { title, copied, canCopy, menuItems, onOpen, onCopy } = props

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minHeight: 132,
        p: 3,
        borderRadius: 3,
        bgcolor: 'var(--studio-paper)',
        boxShadow: 'var(--studio-shadow-soft)',
        transition: 'transform .22s cubic-bezier(.2,.8,.3,1), box-shadow .22s cubic-bezier(.2,.8,.3,1)',
        '&:hover': { transform: 'translateY(-3px)', boxShadow: 'var(--studio-shadow-strong)' },
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
          fontWeight: 500,
          letterSpacing: '-0.005em',
          color: 'var(--studio-text-primary)',
          cursor: 'pointer',
          pr: 10,
          wordBreak: 'break-word',
          '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 3 },
        }}
      >
        {title}
      </Typography>

      <Tooltip title={canCopy ? '复制文本' : '这段文本是空的'}>
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
      </Tooltip>

      <Box sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>
        <MoreActionsMenu items={menuItems} ariaLabel="任务操作" />
      </Box>
    </Box>
  )
}
