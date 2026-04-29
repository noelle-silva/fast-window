import {
  Box, Avatar, Button, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import type { Plugin } from './constants'
import { isDataImageUrl } from './utils'
import { resolveBackendLifecycle, BackendStatusPanel } from './plugins/backendSupervisor'

interface PluginDetailDialogProps {
  plugin: Plugin | null
  pluginsDir: string
  backendStatusById: Record<string, any>
  onClose: () => void
}

const fieldRowSx = { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 1, py: 0.5 } as const
const labelSx = { color: 'text.secondary', fontSize: 13 } as const
const valueSx = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 } as const

export default function PluginDetailDialog({ plugin, pluginsDir, backendStatusById, onClose }: PluginDetailDialogProps) {
  return (
    <Dialog open={!!plugin} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        插件详情
        <IconButton
          aria-label="关闭插件详情"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
          size="small"
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {plugin ? (() => {
          const m = plugin.manifest
          const id = (m?.id || plugin.id || '').trim()
          const name = (m?.name || plugin.name || '').trim()
          const author = (m?.author || '').trim()
          const version = (m?.version || '').trim()
          const main = (m?.main || '').trim()
          const keyword = (m?.keyword || plugin.keyword || '').trim()
          const apiVersion = typeof m?.apiVersion === 'number' ? m.apiVersion : undefined
          const uiType = m?.ui?.type
          const requires = Array.isArray(m?.requires) ? m!.requires : plugin.requires
          const hasBackground = !!m?.background
          const backgroundAutoStart = hasBackground ? (m!.background!.autoStart !== false) : undefined
          const resolvedBg = resolveBackendLifecycle(m)
          const backgroundMain = hasBackground ? ((m!.background!.main || '').trim() || main || '(未指定)') : undefined
          const backendStatus = id ? backendStatusById[id] : undefined
          const pluginPath = pluginsDir && id ? `${pluginsDir}\\${id}` : ''

          return (
            <Box>
              <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', mb: 1.5 }}>
                <Avatar
                  variant="rounded"
                  src={isDataImageUrl(plugin.icon) ? plugin.icon : undefined}
                  imgProps={{ alt: name || 'plugin' }}
                  sx={{ width: 44, height: 44, fontSize: 22, bgcolor: 'action.hover', color: 'text.primary' }}
                >
                  {isDataImageUrl(plugin.icon) ? null : plugin.icon}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body1" sx={{ fontWeight: 800, lineHeight: 1.2 }} noWrap>
                    {name || '(未命名)'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {id || '(无 ID)'}{version ? ` · v${version}` : ''}
                  </Typography>
                </Box>
              </Box>

              <Box sx={fieldRowSx}>
                <Typography sx={labelSx}>目录</Typography>
                <Typography sx={{ ...valueSx, wordBreak: 'break-all' }}>{pluginPath || '(未知)'}</Typography>
              </Box>
              <Box sx={fieldRowSx}>
                <Typography sx={labelSx}>作者</Typography>
                <Typography sx={valueSx}>{author || '(无)'}</Typography>
              </Box>
              <Box sx={fieldRowSx}>
                <Typography sx={labelSx}>入口（main）</Typography>
                <Typography sx={valueSx}>{main || '(未知)'}</Typography>
              </Box>
              <Box sx={fieldRowSx}>
                <Typography sx={labelSx}>关键字（keyword）</Typography>
                <Typography sx={valueSx}>{keyword || '(无)'}</Typography>
              </Box>
              <Box sx={fieldRowSx}>
                <Typography sx={labelSx}>契约版本</Typography>
                <Typography sx={valueSx}>{typeof apiVersion === 'number' ? String(apiVersion) : '(未知)'}</Typography>
              </Box>
              <Box sx={fieldRowSx}>
                <Typography sx={labelSx}>UI 类型</Typography>
                <Typography sx={valueSx}>{uiType || '(未知)'}</Typography>
              </Box>
              <Box sx={fieldRowSx}>
                <Typography sx={labelSx}>后台</Typography>
                <Typography sx={valueSx}>
                  {hasBackground
                    ? (() => {
                        const lc = resolvedBg?.lifecycle
                        const src = resolvedBg?.source
                        const lcText = lc ? `${lc}${src ? `(${src})` : ''}` : '(未知)'
                        const legacyText = src === 'legacy' ? `，autoStart=${backgroundAutoStart ? 'true' : 'false'}` : ''
                        return `启用（lifecycle=${lcText}${legacyText}，main=${backgroundMain}）`
                      })()
                    : '未启用'}
                </Typography>
              </Box>
              {hasBackground ? <BackendStatusPanel status={backendStatus} labelSx={labelSx} valueSx={valueSx} fieldRowSx={fieldRowSx} /> : null}

              <Box sx={{ mt: 1 }}>
                <Typography sx={{ color: 'text.secondary', fontSize: 13, mb: 0.5 }}>描述</Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {typeof m?.description === 'string' ? m.description : (plugin.description || '(无)')}
                </Typography>
              </Box>
              <Box sx={{ mt: 1.25 }}>
                <Typography sx={{ color: 'text.secondary', fontSize: 13, mb: 0.5 }}>能力（requires）</Typography>
                {Array.isArray(requires) && requires.length ? (
                  <Box component="ul" sx={{ m: 0, pl: 2 }}>
                    {requires.map(cap => (
                      <li key={String(cap)}>
                        <Typography sx={valueSx}>{String(cap)}</Typography>
                      </li>
                    ))}
                  </Box>
                ) : (
                  <Typography sx={valueSx} color="text.secondary">(空)</Typography>
                )}
              </Box>
            </Box>
          )
        })() : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
