import * as React from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { Box, Button, ClickAwayListener, Divider, IconButton, InputAdornment, Paper, TextField, Typography } from '@mui/material'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { StandaloneWindowControls } from './StandaloneWindowControls'
import type { ClipboardHistoryController } from '../hooks/useClipboardHistoryController'

type TopbarProps = {
  controller: ClipboardHistoryController
}

export function Topbar(props: TopbarProps) {
  const { controller } = props
  const { state } = controller
  const isClipboard = state.view === 'clipboard'

  const run = React.useCallback((fn: () => Promise<void> | void) => {
    Promise.resolve(fn()).catch(error => controller.host.toast(String((error as any)?.message || error || '操作失败')))
  }, [controller.host])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest('button, a, input, textarea, select, [role="button"], [data-window-controls="true"], [data-window-drag-ignore="true"]')) return
    run(controller.host.startDragging)
  }, [controller.host.startDragging, run])

  return (
    <Box
      data-area="topbar"
      onPointerDown={handlePointerDown}
      sx={{
        height: 44,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        boxShadow: 1,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <IconButton size="small" aria-label="返回主页" title="返回主页" onClick={() => run(controller.host.back)}>
        <ArrowBackRoundedIcon fontSize="small" />
      </IconButton>

      <Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 72 }}>
        {isClipboard ? '剪贴板历史' : '收藏夹'}
      </Typography>

      <TextField
        data-window-drag-ignore="true"
        value={isClipboard ? state.clipboardSearchQuery : state.folderSearchQuery}
        onChange={(event) => {
          const value = event.target.value
          if (isClipboard) controller.setClipboardSearchQuery(value)
          else controller.setFolderSearchQuery(value)
        }}
        placeholder={
          isClipboard
            ? '搜索文本（图片不参与）'
            : state.folderSearchScope === 'global'
              ? '全局搜索（标题/内容）'
              : '当前收藏夹内搜索（含子收藏夹）'
        }
        size="small"
        sx={{ width: 280, maxWidth: '46vw' }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchRoundedIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
      />

      {isClipboard ? (
        <ClipboardTopbarActions controller={controller} />
      ) : (
        <FoldersTopbarActions controller={controller} />
      )}

      <Box sx={{ flex: 1 }} />

      {isClipboard ? (
        <Button color="secondary" variant="contained" onClick={() => controller.setView('folders')} disabled={!controller.isReady}>
          收藏夹
        </Button>
      ) : (
        <Button variant="contained" onClick={() => controller.setView('clipboard')} disabled={!controller.isReady}>
          剪贴板
        </Button>
      )}

      {controller.standaloneLaunch ? (
        <StandaloneWindowControls
          actions={{
            minimize: controller.host.minimize,
            toggleMaximize: controller.host.toggleMaximize,
            closeToTray: controller.host.closeToTray,
          }}
        />
      ) : null}
    </Box>
  )
}

function ClipboardTopbarActions(props: TopbarProps) {
  const { controller } = props
  const { state } = controller

  return (
    <>
      <ClickAwayListener onClickAway={() => controller.setShowRecentMenu(false)}>
        <Box data-window-drag-ignore="true" sx={{ position: 'relative' }}>
          <Button onClick={() => controller.setShowRecentMenu(!state.showRecentMenu)} disabled={!controller.isReady}>
            最近收藏夹
          </Button>
          {state.showRecentMenu ? (
            <Paper sx={{ position: 'absolute', top: 36, right: 0, minWidth: 280, overflow: 'hidden', zIndex: 30 }}>
              <Box sx={{ px: 1.5, py: 1, color: 'text.secondary', fontSize: 12 }}>最近打开（最多10个）</Box>
              <Divider />
              {state.recentFolders.filter(controller.isFolder).length ? (
                state.recentFolders.filter(controller.isFolder).map(id => (
                  <Button
                    key={id}
                    fullWidth
                    startIcon={<FolderOutlinedIcon fontSize="small" />}
                    sx={{ justifyContent: 'flex-start', border: 0, borderRadius: 0, px: 1.5 }}
                    onClick={() => controller.openRecentFolder(id)}
                  >
                    {controller.folderLabelById(id)}
                  </Button>
                ))
              ) : (
                <Box sx={{ px: 1.5, py: 1, color: 'text.secondary', fontSize: 12 }}>暂无</Box>
              )}
            </Paper>
          ) : null}
        </Box>
      </ClickAwayListener>

      <ClickAwayListener onClickAway={() => controller.setShowMoreMenu(false)}>
        <Box data-window-drag-ignore="true" sx={{ position: 'relative' }}>
          <IconButton size="small" aria-label="更多" onClick={() => controller.setShowMoreMenu(!state.showMoreMenu)} disabled={!controller.isReady}>
            <MoreVertRoundedIcon fontSize="small" />
          </IconButton>
          {state.showMoreMenu ? (
            <Paper sx={{ position: 'absolute', top: 36, right: 0, minWidth: 220, overflow: 'hidden', zIndex: 30 }}>
              <Box sx={{ px: 1.5, py: 1, color: 'text.secondary', fontSize: 12 }}>更多</Box>
              <Divider />
              <Button
                fullWidth
                startIcon={<SettingsOutlinedIcon fontSize="small" />}
                sx={{ justifyContent: 'flex-start', border: 0, borderRadius: 0, px: 1.5 }}
                onClick={controller.toggleSettings}
              >
                设置
              </Button>
              <Button
                fullWidth
                color="error"
                startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                sx={{ justifyContent: 'flex-start', border: 0, borderRadius: 0, px: 1.5 }}
                onClick={() => void controller.clearHistory()}
              >
                清空历史
              </Button>
            </Paper>
          ) : null}
        </Box>
      </ClickAwayListener>
    </>
  )
}

function FoldersTopbarActions(props: TopbarProps) {
  const { controller } = props
  const label = controller.state.folderSearchScope === 'global' ? '全局' : '当前'

  return (
    <Button onClick={controller.toggleFolderSearchScope} disabled={!controller.isReady}>
      {label}
    </Button>
  )
}
