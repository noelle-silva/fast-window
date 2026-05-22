import { useEffect, useState } from 'react'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from '@mui/material'
import type { Plugin } from './constants'

export type PluginUninstallDialogState = {
  plugin: Plugin
} | null

export default function PluginUninstallDialog(props: {
  state: PluginUninstallDialogState
  busy: boolean
  onClose: () => void
  onConfirm: (deleteData: boolean) => void
}) {
  const { state, busy, onClose, onConfirm } = props
  const [deleteData, setDeleteData] = useState(false)
  const plugin = state?.plugin ?? null

  useEffect(() => {
    if (plugin) setDeleteData(false)
  }, [plugin])

  return (
    <Dialog open={!!plugin} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>卸载插件</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Typography variant="body2">
          {plugin ? `确定要卸载「${plugin.name}」吗？卸载后插件入口会从主页移除。` : ''}
        </Typography>
        <FormControlLabel
          sx={{ mt: 1.5, alignItems: 'flex-start' }}
          control={(
            <Checkbox
              checked={deleteData}
              disabled={busy}
              onChange={event => setDeleteData(event.target.checked)}
              sx={{ mt: -0.75 }}
            />
          )}
          label={(
            <Typography variant="body2">
              同时删除这个插件的数据目录和自定义图标
            </Typography>
          )}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          不勾选时，插件数据会保留，之后重新安装同 ID 插件仍可继续使用。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button
          color="error"
          variant="contained"
          disabled={busy || !plugin}
          onClick={() => onConfirm(deleteData)}
          sx={{ boxShadow: 'none' }}
        >
          卸载
        </Button>
      </DialogActions>
    </Dialog>
  )
}
