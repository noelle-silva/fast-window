import { Box, IconButton, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded'
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import ViewModuleRoundedIcon from '@mui/icons-material/ViewModuleRounded'
import AppsRoundedIcon from '@mui/icons-material/AppsRounded'
import NavigateBeforeRoundedIcon from '@mui/icons-material/NavigateBeforeRounded'
import NavigateNextRoundedIcon from '@mui/icons-material/NavigateNextRounded'
import type { PluginBrowseLayout } from './constants'

export interface TitleBarProps {
  title: string
  translucent?: boolean
  translucentOpacity?: number
  translucentBlur?: number
  onBack?: () => void
  onPrevWallpaper?: () => void
  onNextWallpaper?: () => void
  wallpaperSwitchDisabled?: boolean
  onStore?: () => void
  onImportPlugin?: () => void
  onSettings?: () => void
  onReloadPlugins?: () => void
  reloadDisabled?: boolean
  reorderMode?: boolean
  onStartReorder?: () => void
  onSaveReorder?: () => void
  onCancelReorder?: () => void
  browseLayout?: PluginBrowseLayout
  onToggleBrowseLayout?: () => void
  showDivider?: boolean
}

export default function TitleBar(props: TitleBarProps) {
  const {
    title,
    translucent,
    translucentOpacity,
    translucentBlur,
    onBack,
    onPrevWallpaper,
    onNextWallpaper,
    wallpaperSwitchDisabled,
    onStore,
    onImportPlugin,
    onSettings,
    onReloadPlugins,
    reloadDisabled,
    reorderMode,
    onStartReorder,
    onSaveReorder,
    onCancelReorder,
    browseLayout,
    onToggleBrowseLayout,
    showDivider = true,
  } = props
  return (
    <Box
      data-tauri-drag-region="true"
      sx={{
        height: 40,
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        px: 0.5,
        bgcolor: translucent
          ? (theme: any) =>
              alpha(theme.palette.background.paper, Math.max(0, Math.min(1, typeof translucentOpacity === 'number' ? translucentOpacity : 0.62)))
          : 'background.paper',
        backdropFilter: translucent
          ? `blur(${Math.max(0, Math.min(40, typeof translucentBlur === 'number' ? translucentBlur : 12))}px)`
          : undefined,
        borderBottom: showDivider ? 1 : 0,
        borderColor: showDivider ? 'divider' : undefined,
        WebkitAppRegion: 'drag',
      }}
    >
      {onBack ? (
        <Box
          data-tauri-drag-region="false"
          sx={{ position: 'absolute', left: 6, display: 'flex', alignItems: 'center', gap: 0.5, WebkitAppRegion: 'no-drag' }}
        >
          <IconButton aria-label="返回" size="small" onClick={onBack}>
            <ArrowBackRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      ) : null}

      {!onBack ? (
        <Box
          data-tauri-drag-region="false"
          sx={{ position: 'absolute', right: 6, display: 'flex', alignItems: 'center', gap: 0.5, WebkitAppRegion: 'no-drag' }}
        >
          {reorderMode ? (
            <>
              {onCancelReorder ? (
                <IconButton aria-label="取消排序" size="small" onClick={onCancelReorder}>
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onSaveReorder ? (
                <IconButton aria-label="保存排序" size="small" onClick={onSaveReorder}>
                  <CheckRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
            </>
          ) : (
            <>
              {onPrevWallpaper && onNextWallpaper ? (
                <>
                  <IconButton aria-label="上一张壁纸" size="small" onClick={onPrevWallpaper} disabled={wallpaperSwitchDisabled}>
                    <NavigateBeforeRoundedIcon fontSize="small" />
                  </IconButton>
                  <IconButton aria-label="下一张壁纸" size="small" onClick={onNextWallpaper} disabled={wallpaperSwitchDisabled}>
                    <NavigateNextRoundedIcon fontSize="small" />
                  </IconButton>
                </>
              ) : null}
              {onImportPlugin ? (
                <IconButton aria-label="导入插件" size="small" onClick={onImportPlugin}>
                  <FileUploadRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onReloadPlugins ? (
                <IconButton aria-label="刷新插件" size="small" onClick={onReloadPlugins} disabled={reloadDisabled}>
                  <RefreshRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onStore ? (
                <IconButton aria-label="应用商店" size="small" onClick={onStore}>
                  <StorefrontRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onToggleBrowseLayout ? (
                <IconButton
                  aria-label={
                    browseLayout === 'list'
                      ? '切换为网格布局'
                      : browseLayout === 'grid'
                        ? '切换为图标布局'
                        : '切换为列表布局'
                  }
                  size="small"
                  onClick={onToggleBrowseLayout}
                >
                  {browseLayout === 'list' ? (
                    <ViewModuleRoundedIcon fontSize="small" />
                  ) : browseLayout === 'grid' ? (
                    <AppsRoundedIcon fontSize="small" />
                  ) : (
                    <ViewListRoundedIcon fontSize="small" />
                  )}
                </IconButton>
              ) : null}
              {onStartReorder ? (
                <IconButton aria-label="拖拽排序模式" size="small" onClick={onStartReorder}>
                  <DragIndicatorRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
              {onSettings ? (
                <IconButton aria-label="设置" size="small" onClick={onSettings}>
                  <SettingsRoundedIcon fontSize="small" />
                </IconButton>
              ) : null}
            </>
          )}
        </Box>
      ) : null}

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          width: '100%',
          textAlign: 'center',
          fontWeight: 600,
          letterSpacing: 0.2,
          px: 4,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {title}
      </Typography>
    </Box>
  )
}
