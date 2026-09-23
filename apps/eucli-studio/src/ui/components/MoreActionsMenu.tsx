import * as React from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import MoreVertIcon from '@mui/icons-material/MoreVert'

export type MoreActionsMenuItem = {
  key: string
  label: React.ReactNode
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  confirm?: {
    title: string
    description?: React.ReactNode
    confirmLabel?: string
  }
  onSelect: () => void
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

  const selectItem = (item: MoreActionsMenuItem) => {
    setMenuEl(null)
    if (item.disabled) return
    if (item.confirm) {
      setPendingConfirm(item)
      return
    }
    item.onSelect()
  }

  const confirmPending = () => {
    const item = pendingConfirm
    setPendingConfirm(null)
    item?.onSelect()
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
      <Menu
        anchorEl={menuEl}
        open={!!menuEl}
        onClose={() => setMenuEl(null)}
        transitionDuration={{ enter: 0, exit: 0 }}
        onClick={(event) => event.stopPropagation()}
      >
        {items.map((item) => (
          <MenuItem
            key={item.key}
            disabled={item.disabled}
            onClick={() => selectItem(item)}
            sx={{ gap: 1, ...(item.danger ? { color: 'error.main' } : {}) }}
          >
            {item.icon}
            {item.label}
          </MenuItem>
        ))}
      </Menu>
      <Dialog
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
          <Button color="error" variant="contained" onClick={confirmPending}>
            {pendingConfirm?.confirm?.confirmLabel || '删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
