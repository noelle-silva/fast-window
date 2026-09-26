import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'
import type { HyperCortexDeletedRepo } from '../../gateway'

// 永久删除的确认句：带仓库名，强制看清删除对象。
export function permanentDeletePhrase(repoTitle: string): string {
  return `我同意永久删除仓库「${repoTitle}」及其全部数据`
}

export function PermanentDeleteRepoDialog(props: {
  target: HyperCortexDeletedRepo | null
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { target, busy, onClose, onConfirm } = props
  const [typed, setTyped] = React.useState('')
  const phrase = target ? permanentDeletePhrase(target.title) : ''
  // 比对规则：忽略首尾空白，其余一字不差。
  const matched = phrase !== '' && typed.trim() === phrase

  React.useEffect(() => {
    if (target) setTyped('')
  }, [target])

  return (
    <Dialog
      open={!!target}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 7 } }}
    >
      <DialogTitle>永久删除仓库</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography sx={{ fontSize: 13, lineHeight: 1.7, color: 'var(--hc-text)' }}>
          此操作会从磁盘上彻底清除仓库「{target?.title || ''}」及其全部数据，无法恢复。请手动输入下面这句话以确认：
        </Typography>

        <Box
          sx={{
            px: 1.5,
            py: 1.25,
            borderRadius: 2,
            bgcolor: 'var(--hc-surface-soft)',
            // 该句只供照抄，禁止选中与复制。
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          <Typography sx={{ fontSize: 13.5, fontWeight: 800, lineHeight: 1.7, color: 'var(--hc-text)', wordBreak: 'break-all' }}>
            {phrase}
          </Typography>
        </Box>

        <TextField
          autoFocus
          margin="dense"
          label="在此输入确认文字"
          fullWidth
          value={typed}
          disabled={busy}
          onChange={event => setTyped(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (matched) onConfirm()
          }}
          inputProps={{ 'aria-label': '确认文字' }}
        />

        <Typography sx={{ fontSize: 12, lineHeight: 1.6, color: matched ? 'var(--hc-success)' : 'var(--hc-text-subtle)' }}>
          {matched
            ? '文字已匹配，可以永久删除。'
            : '需完整输入上方句子（首尾空白会被忽略）后，永久删除按钮才会启用。'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="contained" color="error" onClick={onConfirm} disabled={busy || !matched}>
          {busy ? '删除中…' : '永久删除'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
