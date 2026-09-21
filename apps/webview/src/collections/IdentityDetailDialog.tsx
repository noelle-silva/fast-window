import * as React from 'react'
import { Box, Button, Chip, Dialog, DialogContent, Stack, TextField, Typography } from '@mui/material'
import type { IdentityInfo } from './types'

/**
 * 登录信息详情：编辑名称与描述、查看使用它的图标。
 * 由设置管理页与图标编辑的编辑按钮共用（同一实体的同一编辑机制）。
 */
export function IdentityDetailDialog(props: {
  busy: boolean
  identity: IdentityInfo | null
  onClose(): void
  onSave(name: string, description: string): void
}) {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')

  React.useEffect(() => {
    if (!props.identity) return
    setName(props.identity.name)
    setDescription(props.identity.description)
  }, [props.identity])

  const identity = props.identity
  return (
    <Dialog open={Boolean(identity)} onClose={props.onClose} fullWidth maxWidth="xs">
      <DialogContent sx={{ p: 3 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography variant="h2">登录信息</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              名称与描述只属于这条登录信息，修改不会影响使用它的图标名称。
            </Typography>
          </Box>
          <TextField
            label="名称"
            value={name}
            onChange={event => setName(event.target.value)}
            autoFocus
            fullWidth
          />
          <TextField
            label="描述"
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="例如：工作账号 / 备用账号"
            multiline
            minRows={2}
            fullWidth
          />
          <Box>
            <Typography variant="caption" color="text.secondary">来源网址</Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{identity?.url || '未知'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">使用它的图标</Typography>
            {identity?.usedBy.length ? (
              <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mt: 0.5 }}>
                {identity.usedBy.map(usage => <Chip key={usage.id} size="small" label={usage.name} />)}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>暂无图标使用</Typography>
            )}
          </Box>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={props.onClose}>取消</Button>
            <Button
              variant="contained"
              onClick={() => props.onSave(name.trim(), description.trim())}
              disabled={props.busy || !name.trim()}
            >
              保存
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
