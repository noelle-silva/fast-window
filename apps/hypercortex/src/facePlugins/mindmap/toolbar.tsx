import * as React from 'react'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import { IconButton, Tooltip } from '@mui/material'

import type { FaceToolbarProps } from '../protocol'

/** 思维导图面工具条左插槽：骨架实现，按真实控件替换。 */
export function MindmapLeftToolbar({ disabled }: FaceToolbarProps): React.ReactNode {
  return (
    <Tooltip title="思维导图面操作" placement="bottom-start">
      <IconButton size="small" aria-label="思维导图面操作" disabled={disabled} onClick={() => {}}>
        <TuneRoundedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}

/** 思维导图面工具条右插槽：骨架实现，按真实控件替换。 */
export function MindmapRightToolbar({ disabled }: FaceToolbarProps): React.ReactNode {
  return (
    <Tooltip title="思维导图面操作" placement="bottom-start">
      <IconButton size="small" aria-label="思维导图面操作" disabled={disabled} onClick={() => {}}>
        <TuneRoundedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}
