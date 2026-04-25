import * as React from 'react'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'

type BreadcrumbItem = {
  id: string
  title: string
}

function modeLabel(editMode: boolean): string {
  return editMode ? '布局编辑模式' : '阅读模式'
}

type Props = {
  breadcrumb: BreadcrumbItem[]
  canGoBack: boolean
  currentTitle: string
  refsCount: number
  editMode: boolean
  currentFolderId: string
  onGoBack: () => void
  onNavigateFolder: (folderId: string) => void
  onOpenAddMenu: (el: HTMLElement) => void
  onToggleEditMode: () => void
  onDeleteCurrentFolder: () => void
}

export function IndexPageToolbar(props: Props): React.ReactNode {
  const {
    breadcrumb,
    canGoBack,
    currentTitle,
    refsCount,
    editMode,
    currentFolderId,
    onGoBack,
    onNavigateFolder,
    onOpenAddMenu,
    onToggleEditMode,
    onDeleteCurrentFolder,
  } = props

  const modeText = modeLabel(editMode)

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', pb: 1.25 }}>
        <Tooltip title={canGoBack ? '返回上一级' : '没有上一层'}>
          <span>
            <IconButton size="small" onClick={onGoBack} disabled={!canGoBack} aria-label="返回上一级索引路径">
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {breadcrumb.map((item, idx) => {
          const isLast = idx === breadcrumb.length - 1
          return (
            <React.Fragment key={`${item.id}_${idx}`}>
              <Box
                onClick={() => {
                  if (isLast) return
                  onNavigateFolder(item.id)
                }}
                role={isLast ? undefined : 'button'}
                tabIndex={isLast ? -1 : 0}
                onKeyDown={e => {
                  if (isLast) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onNavigateFolder(item.id)
                  }
                }}
                sx={{
                  cursor: isLast ? 'default' : 'pointer',
                  userSelect: 'none',
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 2,
                  '&:hover': isLast ? undefined : { bgcolor: 'rgba(0,0,0,.03)' },
                }}
              >
                <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.70)', fontWeight: isLast ? 800 : 700 }}>{item.title}</Typography>
              </Box>
              {!isLast ? <Typography sx={{ fontSize: 13, color: 'rgba(0,0,0,.38)' }}>›</Typography> : null}
            </React.Fragment>
          )
        })}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pb: 1.25 }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 18, fontWeight: 900, color: '#111', lineHeight: 1.2 }}>{currentTitle}</Typography>
            <Box
              aria-label={`当前模式：${modeText}`}
              sx={{
                px: 1,
                py: 0.25,
                borderRadius: 999,
                border: '1px solid',
                borderColor: editMode ? 'rgba(25,118,210,.22)' : 'rgba(0,0,0,.14)',
                bgcolor: editMode ? 'rgba(25,118,210,.08)' : 'rgba(0,0,0,.03)',
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 800, color: editMode ? 'rgba(25,118,210,.92)' : 'rgba(0,0,0,.62)' }}>
                {modeText}
              </Typography>
            </Box>
          </Box>
          <Typography sx={{ fontSize: 12, color: 'rgba(0,0,0,.50)', pt: 0.25 }}>{refsCount} 条</Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {editMode && currentFolderId !== 'root' ? (
            <Button variant="outlined" color="error" onClick={onDeleteCurrentFolder} sx={{ borderRadius: 999, whiteSpace: 'nowrap' }}>
              删除当前收藏夹实体
            </Button>
          ) : null}

          {editMode ? (
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={e => onOpenAddMenu(e.currentTarget)} sx={{ borderRadius: 999 }}>
              添加
            </Button>
          ) : null}

          <Button
            variant={editMode ? 'outlined' : 'contained'}
            onClick={onToggleEditMode}
            aria-label={editMode ? '完成布局编辑，返回阅读模式' : '进入布局编辑模式'}
            sx={{ borderRadius: 999, whiteSpace: 'nowrap' }}
          >
            {editMode ? '完成布局编辑' : '进入布局编辑'}
          </Button>
        </Box>
      </Box>
    </>
  )
}
