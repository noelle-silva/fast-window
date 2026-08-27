import * as React from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import ExpandLessOutlinedIcon from '@mui/icons-material/ExpandLessOutlined'
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined'
import StopOutlinedIcon from '@mui/icons-material/StopOutlined'
import { Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import type { SpaceEntry } from '../executionSpace'

type ExecutionSpacePageProps = {
  repoName: string
  entries: SpaceEntry[]
  stoppingRunIds: Set<string>
  onBack: () => void
  onStopRun: (runId: string) => void
  onRemoveEntry: (runId: string) => void
  onToggleCollapse: (runId: string) => void
}

function statusLabel(entry: SpaceEntry): string {
  if (entry.status === 'running') return '运行中'
  if (entry.exitCode === 0) return '已完成'
  return `已结束（退出码 ${entry.exitCode ?? '未知'}）`
}

function SpaceCardOutput({ entry }: { entry: SpaceEntry }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const container = containerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [entry.lines.length, entry.collapsed])

  return (
    <Box className="cr-space-output" role="log" aria-label={`${entry.commandName} 输出`} ref={containerRef}>
      {entry.lines.length === 0 ? (
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>等待输出…</Typography>
      ) : entry.lines.map((line, index) => (
        <Box key={index} className={`cr-space-line ${line.stream === 'stderr' ? 'cr-space-line-stderr' : ''}`}>
          {line.text}
        </Box>
      ))}
    </Box>
  )
}

export function ExecutionSpacePage({
  repoName,
  entries,
  stoppingRunIds,
  onBack,
  onStopRun,
  onRemoveEntry,
  onToggleCollapse,
}: ExecutionSpacePageProps) {
  return (
    <Box className="cr-repo-page">
      <Box className="cr-repo-page-header">
        <Tooltip title="返回仓库命令列表">
          <IconButton size="small" onClick={onBack} aria-label="返回仓库命令列表">
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box className="cr-repo-page-heading">
          <Typography component="h1" sx={{ fontSize: 17, fontWeight: 900 }} noWrap>内置执行空间 · {repoName}</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>以内置模式运行的命令会在这里实时输出，输出不经过独立窗口。</Typography>
        </Box>
      </Box>

      <Box className="cr-space-list">
        {entries.length === 0 ? (
          <Box className="cr-empty-state">
            <Typography component="strong" sx={{ fontSize: 14, fontWeight: 900 }}>还没有内置运行</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
              在命令列表中把命令的运行模式设为「内置执行空间」并运行，输出卡片就会出现在这里。
            </Typography>
          </Box>
        ) : entries.map(entry => {
          const countdownLeft = entry.countdownEndsAt !== null
            ? Math.max(0, Math.ceil((entry.countdownEndsAt - Date.now()) / 1000))
            : null
          return (
            <Box key={entry.runId} className="cr-space-card">
              <Box className="cr-space-card-header">
                <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Box
                    className={`cr-run-dot ${entry.status === 'running' ? 'cr-run-dot-running' : 'cr-run-dot-ended'}`}
                    aria-hidden="true"
                  />
                  <Typography sx={{ minWidth: 0, fontSize: 13, fontWeight: 900 }} noWrap>{entry.commandName || '未命名命令'}</Typography>
                  <Chip
                    size="small"
                    color={entry.status === 'running' ? 'success' : (entry.exitCode === 0 ? 'default' : 'warning')}
                    variant="outlined"
                    label={countdownLeft !== null && countdownLeft > 0 ? `${countdownLeft} 秒后关闭` : statusLabel(entry)}
                    sx={{ fontWeight: 800, fontSize: 11, height: 22, flexShrink: 0 }}
                  />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {entry.status === 'running' ? (
                    <Tooltip title="停止运行">
                      <span>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          startIcon={<StopOutlinedIcon fontSize="small" />}
                          disabled={stoppingRunIds.has(entry.runId)}
                          onClick={() => onStopRun(entry.runId)}
                        >
                          {stoppingRunIds.has(entry.runId) ? '停止中' : '停止'}
                        </Button>
                      </span>
                    </Tooltip>
                  ) : null}
                  <Tooltip title={entry.collapsed ? '展开输出' : '折叠输出'}>
                    <IconButton size="small" aria-label={entry.collapsed ? '展开输出' : '折叠输出'} onClick={() => onToggleCollapse(entry.runId)}>
                      {entry.collapsed ? <ExpandMoreOutlinedIcon fontSize="small" /> : <ExpandLessOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="关闭此卡片">
                    <IconButton size="small" aria-label="关闭此卡片" onClick={() => onRemoveEntry(entry.runId)}>
                      <CloseOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              {!entry.collapsed ? <SpaceCardOutput entry={entry} /> : null}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
