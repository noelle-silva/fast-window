import * as React from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import type { PlaceholderItem } from '../../domain/placeholder'
import { PlaceholderDependencyTreePanel } from '../settings/PlaceholderDependencyTreePanel'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'

type PlaceholderDetailDialogProps = {
  controller: any
  placeholders?: any
  name: string
  onClose: () => void
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function PlaceholderDetailDialog(props: PlaceholderDetailDialogProps) {
  const { controller, placeholders, name, onClose } = props
  const target = text(name)

  // 关闭动画期间沿用最后一次的名字：避免淡出的一瞬间内容变成空 / 未注册红字。
  const [retained, setRetained] = React.useState('')
  if (target && target !== retained) setRetained(target)
  const shown = target || retained

  const item = React.useMemo<PlaceholderItem | null>(() => {
    const list = placeholders?.library?.placeholders
    if (!Array.isArray(list)) return null
    return list.find((entry: PlaceholderItem) => text(entry?.name) === shown) || null
  }, [placeholders?.library, shown])

  React.useEffect(() => {
    if (!target) return
    controller.actions.loadPlaceholderDependencies?.(target)?.catch?.(() => null)
  }, [controller, target])

  const copyToken = () => {
    const capabilities = controller?.capabilities
    const writeText = capabilities?.clipboard?.writeText
    if (typeof writeText !== 'function') return capabilities?.ui?.showToast?.('未授权：clipboard.writeText', { kind: 'error' })
    Promise.resolve()
      .then(() => writeText(`{{${shown}}}`))
      .then(() => capabilities?.ui?.showToast?.('已复制占位符', { kind: 'success' }))
      .catch(() => capabilities?.ui?.showToast?.('复制失败', { kind: 'error' }))
  }

  const pluginSourced = item?.source?.kind === 'system_plugin'

  return (
    <Dialog open={!!target} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { bgcolor: 'var(--studio-paper-muted)' } }}>
      <DialogTitle>{`{{${shown}}}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25} sx={{ pt: 1.5 }}>
          {item ? (
            <Typography variant="body2" color="text.secondary">{text(item.description) || '暂无描述'}</Typography>
          ) : (
            <Typography variant="body2" color="error.main">这个占位符还没有注册：提示词里的引用不会被替换。</Typography>
          )}
          {item ? (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>值</Typography>
              <Box
                sx={{
                  mt: 0.5,
                  p: 1.25,
                  borderRadius: 2,
                  bgcolor: 'var(--studio-field)',
                  boxShadow: 'var(--studio-shadow-soft)',
                  minHeight: 72,
                  maxHeight: 220,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  display: pluginSourced ? 'grid' : 'block',
                  placeItems: pluginSourced ? 'center' : undefined,
                  ...customScrollbarHiddenSx,
                }}
              >
                {pluginSourced ? (
                  <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'center', color: 'primary.main' }}>
                    这个占位符的值由系统插件动态提供，保存的手写值不会参与解析。
                  </Typography>
                ) : (
                  <Typography variant="body2">{String(item.value ?? '') || '（空）'}</Typography>
                )}
              </Box>
            </Box>
          ) : null}
          <PlaceholderDependencyTreePanel tree={placeholders?.dependencyTree} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<ContentCopyIcon />} onClick={copyToken} disabled={!target}>复制占位符</Button>
        <Button variant="contained" onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
