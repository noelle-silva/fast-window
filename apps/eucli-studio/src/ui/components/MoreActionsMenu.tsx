import * as React from 'react'
import { Box, Button, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Tooltip, Typography } from '@mui/material'
import { DependableDialog, DependableMenu } from './DependableOverlay'
import MoreVertIcon from '@mui/icons-material/MoreVert'

export type MoreActionsMenuItem = {
  key: string
  label: React.ReactNode
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  /** 只读信息行：不可点、不聚焦，仍然一行一个地展示。 */
  readOnly?: boolean
  confirm?: {
    title: string
    description?: React.ReactNode
    confirmLabel?: string
    /** 确认按钮语气：危险动作（默认）用错误色，中性动作用主题色。 */
    tone?: 'danger' | 'primary'
  }
  /**
   * anchor 是「更多」按钮元素：菜单关闭后 MenuItem 会被卸载，
   * 需要弹层的调用方只能拿这个稳定元素做锚点。
   */
  onSelect: (anchor: HTMLElement | null) => void
}

type MoreActionsMenuProps = {
  items: MoreActionsMenuItem[]
  disabled?: boolean
  ariaLabel?: string
  tooltip?: string
}

export function MoreActionsMenu(props: MoreActionsMenuProps) {
  const { items, disabled, ariaLabel = '更多操作', tooltip = '更多操作' } = props
  const [menuEl, setMenuEl] = React.useState<HTMLElement | null>(null)
  const [pendingConfirm, setPendingConfirm] = React.useState<MoreActionsMenuItem | null>(null)
  // 菜单一关，MenuItem 就被卸载；锚点必须在关闭前抓住并留给确认流程复用。
  const menuAnchorRef = React.useRef<HTMLElement | null>(null)

  const selectItem = (item: MoreActionsMenuItem) => {
    menuAnchorRef.current = menuEl
    setMenuEl(null)
    if (item.disabled) return
    if (item.confirm) {
      setPendingConfirm(item)
      return
    }
    item.onSelect(menuAnchorRef.current)
  }

  const confirmPending = () => {
    const item = pendingConfirm
    setPendingConfirm(null)
    item?.onSelect(menuAnchorRef.current)
  }

  return (
    <>
      <Tooltip title={tooltip}>
        <span>
          <IconButton
            size="small"
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation()
              setMenuEl(event.currentTarget)
            }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <DependableMenu
        anchorEl={menuEl}
        open={!!menuEl}
        onClose={() => setMenuEl(null)}
        transitionDuration={{ enter: 0, exit: 0 }}
        onClick={(event) => event.stopPropagation()}
      >
        {items.map((item) =>
          item.readOnly ? (
            <Box
              key={item.key}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75, typography: 'body2', color: 'text.secondary' }}
            >
              {item.icon}
              {item.label}
            </Box>
          ) : (
            <MenuItem
              key={item.key}
              disabled={item.disabled}
              onClick={() => selectItem(item)}
              sx={{ gap: 1, ...(item.danger ? { color: 'error.main' } : {}) }}
            >
              {item.icon}
              {item.label}
            </MenuItem>
          ),
        )}
      </DependableMenu>
      <DependableDialog
        open={!!pendingConfirm}
        onClose={() => setPendingConfirm(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}
      >
        <DialogTitle>{pendingConfirm?.confirm?.title}</DialogTitle>
        {pendingConfirm?.confirm?.description ? (
          <DialogContent>
            <Typography variant="body2" color="text.secondary">{pendingConfirm.confirm.description}</Typography>
          </DialogContent>
        ) : null}
        <DialogActions>
          <Button onClick={() => setPendingConfirm(null)}>取消</Button>
          <Button
            color={pendingConfirm?.confirm?.tone === 'primary' ? 'primary' : 'error'}
            variant="contained"
            onClick={confirmPending}
          >
            {pendingConfirm?.confirm?.confirmLabel || '删除'}
          </Button>
        </DialogActions>
      </DependableDialog>
    </>
  )
}
