import * as React from 'react'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { Box, Button, ClickAwayListener, IconButton, InputAdornment, Paper, TextField } from '@mui/material'
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
        display: 'grid',
        gridTemplateColumns: { xs: 'auto minmax(120px, 1fr) auto', sm: '1fr minmax(320px, 560px) 1fr' },
        alignItems: 'center',
        columnGap: 1,
        px: 1.25,
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.06)',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <IconButton size="small" aria-label="返回主页" title="返回主页" onClick={() => run(controller.host.back)}>
          <ArrowBackRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="剪贴板历史"
          title="剪贴板历史"
          disabled={!controller.isReady}
          onClick={() => controller.setView('clipboard')}
          sx={viewButtonSx(isClipboard)}
        >
          <ContentPasteRoundedIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="收藏夹"
          title="收藏夹"
          disabled={!controller.isReady}
          onClick={() => controller.setView('folders')}
          sx={viewButtonSx(!isClipboard)}
        >
          <FolderRoundedIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, minWidth: 0 }}>
        <TopbarSearchField controller={controller} />
        {isClipboard ? <RecentFoldersMenu controller={controller} /> : null}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75, minWidth: 0 }}>
        {!isClipboard ? <FoldersTopbarActions controller={controller} /> : null}

        <IconButton size="small" aria-label="设置" title="设置" onClick={controller.toggleSettings}>
          <SettingsOutlinedIcon fontSize="small" />
        </IconButton>

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
    </Box>
  )
}

function TopbarSearchField(props: TopbarProps) {
  const { controller } = props
  const { state } = controller
  const isClipboard = state.view === 'clipboard'
  const value = isClipboard ? state.clipboardSearchQuery : state.folderSearchQuery

  const setValue = React.useCallback((nextValue: string) => {
    if (isClipboard) controller.setClipboardSearchQuery(nextValue)
    else controller.setFolderSearchQuery(nextValue)
  }, [controller, isClipboard])

  const placeholder = isClipboard
    ? '搜索文本（图片不参与）'
    : state.folderSearchScope === 'global'
      ? '全局搜索（标题/内容）'
      : '当前收藏夹内搜索（含子收藏夹）'

  return (
    <TextField
      data-window-drag-ignore="true"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder={placeholder}
      size="small"
      sx={{ flex: 1, minWidth: 0, maxWidth: 420 }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchRoundedIcon fontSize="small" />
          </InputAdornment>
        ),
        endAdornment: value ? (
          <InputAdornment position="end">
            <IconButton
              aria-label="清空搜索栏"
              title="清空搜索栏"
              edge="end"
              size="small"
              onClick={() => setValue('')}
              sx={{ mr: -0.75 }}
            >
              <ClearRoundedIcon fontSize="small" />
            </IconButton>
          </InputAdornment>
        ) : null,
      }}
    />
  )
}

function viewButtonSx(active: boolean) {
  return {
    bgcolor: active ? 'primary.main' : 'transparent',
    color: active ? 'primary.contrastText' : 'text.secondary',
    '&:hover': {
      bgcolor: active ? 'primary.dark' : 'action.hover',
    },
    '&.Mui-disabled': {
      bgcolor: active ? 'action.selected' : 'transparent',
    },
  }
}

function RecentFoldersMenu(props: TopbarProps) {
  const { controller } = props
  const { state } = controller

  return (
    <ClickAwayListener onClickAway={() => controller.setShowRecentMenu(false)}>
      <Box data-window-drag-ignore="true" sx={{ position: 'relative', ml: 0.5 }}>
        <Button onClick={() => controller.setShowRecentMenu(!state.showRecentMenu)} disabled={!controller.isReady} sx={{ whiteSpace: 'nowrap' }}>
          最近收藏夹
        </Button>
        {state.showRecentMenu ? (
          <Paper sx={{ position: 'absolute', top: 36, right: 0, minWidth: 280, overflow: 'hidden', zIndex: 30, boxShadow: 8 }}>
            <Box sx={{ px: 1.5, py: 1, color: 'text.secondary', fontSize: 12 }}>最近打开（最多10个）</Box>
            {state.recentFolders.filter(controller.isFolder).length ? (
              state.recentFolders.filter(controller.isFolder).map(id => (
                <Button
                  key={id}
                  fullWidth
                  startIcon={<FolderOutlinedIcon fontSize="small" />}
                  sx={{ justifyContent: 'flex-start', borderRadius: 0, px: 1.5 }}
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
