import * as React from 'react'
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import { IconButton, Tooltip } from '@mui/material'

import type { FaceToolbarProps } from '../protocol'

/** 网页面工具条插槽（左）：阅读态全屏预览入口。 */
export function HtmlFaceFullscreenToolbar({ editing, viewState: _viewState, onViewStateChange }: FaceToolbarProps): React.ReactNode {
  if (editing) return null
  return (
    <Tooltip title="全屏预览" placement="bottom-start">
      <IconButton
        size="small"
        aria-label="全屏预览 HTML 面"
        onClick={() => onViewStateChange({ fullscreenOpen: true })}
        sx={{
          color: 'rgba(0,0,0,.58)',
          bgcolor: 'transparent',
          boxShadow: 'none',
          border: 0,
          flex: '0 0 auto',
          '&:hover': { bgcolor: 'rgba(0,0,0,.06)', color: '#111' },
        }}
      >
        <FullscreenRoundedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}

/** 网页面工具条插槽（右）：固定视口缩放调节开关。 */
export function HtmlFaceScaleToolbar({ editing, viewState, onViewStateChange, context }: FaceToolbarProps): React.ReactNode {
  // 按生效设置（笔记级 > 全局 > 声明默认）显隐：仅固定视口缩放模式、且非编辑态时提供缩放调节入口。
  if (editing || context.settings.displayMode !== 'fixed-fit') return null
  const visible = viewState.scaleControlsVisible === true
  return (
    <Tooltip title={visible ? '收起缩放调节' : '展开缩放调节'} placement="bottom-end">
      <IconButton
        size="small"
        aria-label={visible ? '收起缩放调节' : '展开缩放调节'}
        onClick={() => onViewStateChange({ scaleControlsVisible: !visible })}
        sx={{
          color: visible ? 'var(--hc-primary)' : 'var(--hc-text-muted)',
          bgcolor: 'transparent',
          '&:hover': { bgcolor: 'var(--hc-surface-soft)', color: 'var(--hc-text)' },
        }}
      >
        <TuneRoundedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}
