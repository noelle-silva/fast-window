import * as React from 'react'
import {
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RefreshIcon from '@mui/icons-material/Refresh'
import StorageIcon from '@mui/icons-material/Storage'

export function ToolServerToolsDialog(props: {
  open: boolean
  loading: boolean
  ok: null | boolean
  msg: string
  detail: string
  tools: any[]
  count: number
  onClose: () => void
  onRefresh: () => void
}) {
  const { open, loading, ok, msg, detail, tools, count, onClose, onRefresh } = props
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    if (!open) setExpanded({})
  }, [open])

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorageIcon fontSize="small" />
        工具列表
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {Number.isFinite(count) ? `(${count})` : ''}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={onRefresh} disabled={loading}>
          刷新
        </Button>
        <IconButton onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.25}>
          <Typography variant="caption" color="text.secondary">
            说明：该列表来自工具服务器 `GET /api/tools`，需要服务端配置 `TOOL_CALL_SERVER_UI_KEY` 并用 Bearer 鉴权。
          </Typography>

          {loading ? (
            <Typography variant="body2" color="text.secondary">
              加载中…
            </Typography>
          ) : ok === false ? (
            <Paper variant="outlined" sx={{ p: 1.25 }}>
              <Stack spacing={0.75}>
                <Typography sx={{ fontWeight: 900 }}>获取失败</Typography>
                <Typography variant="body2" color="text.secondary">
                  {msg || '请求失败'}
                </Typography>
                {detail ? (
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                      color: 'text.secondary',
                    }}
                  >
                    {detail}
                  </Typography>
                ) : null}
              </Stack>
            </Paper>
          ) : null}

          {!loading && ok === true ? (
            tools?.length ? (
              <Stack spacing={1}>
                {tools.map((t: any) => {
                  const name = String(t?.name || '')
                  const desc = String(t?.description || '')
                  const params = Array.isArray(t?.parameters) ? t.parameters : []
                  const isOpen = !!expanded[name]

                  return (
                    <Paper key={name || Math.random()} variant="outlined" sx={{ overflow: 'hidden' }}>
                      <ListItemButton
                        onClick={() => setExpanded((p) => ({ ...p, [name]: !p[name] }))}
                        sx={{ py: 0.75, alignItems: 'flex-start' }}
                      >
                        <ListItemText
                          primary={
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                              <Typography sx={{ fontWeight: 900 }}>{name || '(未命名工具)'}</Typography>
                              {params.length ? <Chip size="small" variant="outlined" label={`${params.length} 参数`} /> : <Chip size="small" variant="outlined" label="无参数" />}
                            </Stack>
                          }
                          secondary={
                            desc ? (
                              <Typography variant="caption" color="text.secondary">
                                {desc}
                              </Typography>
                            ) : null
                          }
                        />
                        {isOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </ListItemButton>
                      <Collapse in={isOpen} timeout={180} unmountOnExit>
                        <Divider />
                        <Box sx={{ p: 1.25 }}>
                          {desc ? (
                            <Typography variant="body2" sx={{ mb: params.length ? 1 : 0 }}>
                              {desc}
                            </Typography>
                          ) : null}
                          {params.length ? (
                            <Stack spacing={0.75}>
                              {params.map((p: any, idx: number) => {
                                const pn = String(p?.name || '')
                                const pt = String(p?.type || '')
                                const pr = !!p?.required
                                const pd = String(p?.description || '')
                                const def = String(p?.default || '')
                                return (
                                  <Paper key={`${pn}-${idx}`} variant="outlined" sx={{ p: 1 }}>
                                    <Stack spacing={0.25}>
                                      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                                        <Typography sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontWeight: 900 }}>
                                          {pn || '(未命名参数)'}
                                        </Typography>
                                        {pt ? <Chip size="small" variant="outlined" label={pt} /> : null}
                                        {pr ? <Chip size="small" color="warning" label="必填" /> : <Chip size="small" variant="outlined" label="可选" />}
                                        {def ? <Chip size="small" variant="outlined" label={`默认: ${def}`} /> : null}
                                      </Stack>
                                      {pd ? (
                                        <Typography variant="caption" color="text.secondary">
                                          {pd}
                                        </Typography>
                                      ) : null}
                                    </Stack>
                                  </Paper>
                                )
                              })}
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              无参数
                            </Typography>
                          )}
                        </Box>
                      </Collapse>
                    </Paper>
                  )
                })}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                暂无工具，或当前鉴权 Key 无权访问工具列表。
              </Typography>
            )
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

