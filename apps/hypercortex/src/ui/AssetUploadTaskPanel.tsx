import * as React from 'react'
import { Box, IconButton, LinearProgress, Popper, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import PauseRoundedIcon from '@mui/icons-material/PauseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import type { AssetUploadTaskSnapshot } from '../gateway/types'
import {
  ASSET_UPLOAD_TASK_VIEWS,
  type AssetUploadTaskView,
  clampUploadProgress,
  filterUploadTasksByView,
  formatUploadBytes,
  uploadTaskError,
  uploadTaskStatusText,
  uploadTaskTitle,
  uploadTaskViewEmptyText,
  uploadTaskViewLabel,
} from './assetUploadTasks'

type Props = {
  anchorEl: HTMLElement | null
  open: boolean
  tasks: AssetUploadTaskSnapshot[]
  view: AssetUploadTaskView
  unseenFailedTaskCount: number
  onViewChange: (view: AssetUploadTaskView) => void
  onClose: () => void
  onPause: (taskId: string) => void
  onResume: (taskId: string) => void
  onCancel: (taskId: string) => void
}

function taskActionLabel(task: AssetUploadTaskSnapshot): string {
  if (task.status === 'paused') return '继续'
  if (task.status === 'running' || task.status === 'queued') return '暂停'
  return ''
}

function TaskRow({ task, onPause, onResume, onCancel }: {
  task: AssetUploadTaskSnapshot
  onPause: (taskId: string) => void
  onResume: (taskId: string) => void
  onCancel: (taskId: string) => void
}) {
  const progress = clampUploadProgress(task.progress)
  const error = uploadTaskError(task)
  const canPause = task.status === 'running' || task.status === 'queued'
  const canResume = task.status === 'paused'
  const canCancel = task.status === 'running' || task.status === 'queued' || task.status === 'paused'
  const actionLabel = taskActionLabel(task)
  const failed = task.status === 'failed'

  return (
    <Box sx={{ p: 1.25, borderRadius: 2.5, bgcolor: failed ? 'rgba(254,242,242,.96)' : '#fff', border: `1px solid ${failed ? 'rgba(220,38,38,.18)' : 'transparent'}`, boxShadow: failed ? '0 10px 24px rgba(220,38,38,.08)' : '0 10px 24px rgba(15,23,42,.07)' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 900, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={uploadTaskTitle(task)}>
            {uploadTaskTitle(task)}
          </Typography>
          <Typography sx={{ mt: 0.25, fontSize: 11.5, color: error ? '#dc2626' : 'rgba(15,23,42,.56)' }}>
            {error || `${uploadTaskStatusText(task)} · ${formatUploadBytes(task.uploadedBytes)} / ${formatUploadBytes(task.totalBytes)}`}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          {canPause || canResume ? (
            <Tooltip title={actionLabel} placement="bottom">
              <IconButton size="small" aria-label={actionLabel} onClick={() => (canResume ? onResume(task.id) : onPause(task.id))} sx={{ width: 28, height: 28 }}>
                {canResume ? <PlayArrowRoundedIcon sx={{ fontSize: 18 }} /> : <PauseRoundedIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            </Tooltip>
          ) : null}
          {canCancel ? (
            <Tooltip title="取消" placement="bottom">
              <IconButton size="small" aria-label="取消上传任务" onClick={() => onCancel(task.id)} sx={{ width: 28, height: 28, color: '#dc2626' }}>
                <CancelRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
      </Box>
      <LinearProgress
        variant="determinate"
        value={progress}
        color={error ? 'error' : 'primary'}
        sx={{ mt: 1, height: 7, borderRadius: 999, bgcolor: 'rgba(15,23,42,.08)', '& .MuiLinearProgress-bar': { borderRadius: 999 } }}
      />
      <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 11, color: 'rgba(15,23,42,.48)' }}>{Math.round(progress)}%</Typography>
        <Typography sx={{ fontSize: 11, color: 'rgba(15,23,42,.48)' }}>{task.files.length} 个文件</Typography>
      </Box>
    </Box>
  )
}

function TaskViewTabLabel({ view, count, unseenFailedTaskCount }: {
  view: AssetUploadTaskView
  count: number
  unseenFailedTaskCount: number
}) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <Box component="span">{uploadTaskViewLabel(view)} ({count})</Box>
      {view === 'failed' && unseenFailedTaskCount > 0 ? (
        <Box component="span" aria-hidden sx={{ width: 7, height: 7, borderRadius: 999, bgcolor: 'var(--hc-danger)', boxShadow: '0 0 0 3px var(--hc-danger-soft)' }} />
      ) : null}
    </Box>
  )
}

export function AssetUploadTaskPanel(props: Props) {
  const { anchorEl, open, tasks, view, unseenFailedTaskCount, onViewChange, onClose, onPause, onResume, onCancel } = props
  const taskCounts = React.useMemo(() => {
    return ASSET_UPLOAD_TASK_VIEWS.reduce<Record<AssetUploadTaskView, number>>((counts, nextView) => {
      counts[nextView] = filterUploadTasksByView(tasks, nextView).length
      return counts
    }, { active: 0, failed: 0, completed: 0 })
  }, [tasks])
  const visibleTasks = React.useMemo(() => filterUploadTasksByView(tasks, view), [tasks, view])

  return (
    <Popper open={open} anchorEl={anchorEl} placement="bottom-end" sx={{ zIndex: 1400 }} modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}>
      <Box sx={{ width: 380, maxWidth: 'calc(100vw - 24px)', borderRadius: 4, overflow: 'hidden', bgcolor: 'var(--hc-surface)', boxShadow: '0 24px 60px var(--hc-shadow-strong)', backdropFilter: 'blur(18px)' }}>
        <Box sx={{ px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, bgcolor: 'var(--hc-surface-soft)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 30, height: 30, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'var(--hc-primary-soft)', color: 'var(--hc-primary)' }}>
              <CloudUploadRoundedIcon sx={{ fontSize: 18 }} />
            </Box>
            <Typography sx={{ fontSize: 14, fontWeight: 950, color: 'var(--hc-text)' }}>上传任务</Typography>
          </Box>
          <IconButton size="small" aria-label="关闭上传任务窗" onClick={onClose} sx={{ width: 28, height: 28 }}>
            <CloseRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        <Tabs
          value={view}
          onChange={(_, next) => onViewChange(next as AssetUploadTaskView)}
          aria-label="上传任务分类"
          sx={{ minHeight: 36, px: 1.25, '& .MuiTabs-indicator': { height: 0 }, '& .MuiTab-root': { minHeight: 34, borderRadius: 2, fontSize: 12, fontWeight: 900, textTransform: 'none', color: 'var(--hc-text-muted)' }, '& .Mui-selected': { color: 'var(--hc-text)', bgcolor: 'var(--hc-surface-soft)', boxShadow: '0 8px 18px var(--hc-shadow)' } }}
        >
          {ASSET_UPLOAD_TASK_VIEWS.map(taskView => (
            <Tab key={taskView} value={taskView} label={<TaskViewTabLabel view={taskView} count={taskCounts[taskView]} unseenFailedTaskCount={unseenFailedTaskCount} />} />
          ))}
        </Tabs>

        <Box sx={{ maxHeight: 380, overflow: 'auto', p: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {visibleTasks.length ? visibleTasks.map(task => (
            <TaskRow key={task.id} task={task} onPause={onPause} onResume={onResume} onCancel={onCancel} />
          )) : (
            <Box sx={{ py: 5, textAlign: 'center', color: 'rgba(15,23,42,.42)' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{uploadTaskViewEmptyText(view)}</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Popper>
  )
}
