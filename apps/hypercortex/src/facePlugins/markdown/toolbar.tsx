import * as React from 'react'
import CodeRoundedIcon from '@mui/icons-material/CodeRounded'
import WysiwygRoundedIcon from '@mui/icons-material/WysiwygRounded'
import { IconButton, Tooltip } from '@mui/material'

import type { FaceToolbarProps } from '../protocol'

/** 文本面工具条插槽：编辑模式下切换 Live / 源码编辑。 */
export function MarkdownToolbar({ editing, disabled, viewState, onViewStateChange }: FaceToolbarProps): React.ReactNode {
  if (!editing) return null
  const mode = viewState.mode === 'source' ? 'source' : 'live'
  return (
    <Tooltip title={mode === 'source' ? '切换到 Live 编辑' : '切换到 源码编辑'} placement="bottom-start">
      <IconButton
        size="small"
        aria-label={mode === 'source' ? '切换到 Live 编辑' : '切换到 源码编辑'}
        onClick={() => onViewStateChange({ mode: mode === 'source' ? 'live' : 'source' })}
        disabled={disabled}
        sx={{
          color: 'rgba(0,0,0,.58)',
          bgcolor: 'transparent',
          boxShadow: 'none',
          border: 0,
          flex: '0 0 auto',
          '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
          '&.Mui-disabled': { color: 'rgba(0,0,0,.28)' },
        }}
      >
        {mode === 'source' ? <WysiwygRoundedIcon fontSize="small" /> : <CodeRoundedIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  )
}
