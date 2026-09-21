import * as React from 'react'
import { Box, Button, Dialog, DialogContent, Stack, TextField, Typography } from '@mui/material'

export function IdentityDialog(props: {
  busy: boolean
  open: boolean
  sourceName: string
  name: string
  onChange(name: string): void
  onClose(): void
  onSave(): void
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">新建账号身份</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              为“{props.sourceName}”创建一份独立的登录空间，可与原账号同时登录。
            </Typography>
          </Box>
          <TextField
            label="身份名称"
            value={props.name}
            onChange={event => props.onChange(event.target.value)}
            placeholder={`${props.sourceName} · 新身份`}
            autoFocus
            fullWidth
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button variant="contained" onClick={props.onSave} disabled={props.busy}>创建身份</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
