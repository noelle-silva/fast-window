import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import BuildIcon from '@mui/icons-material/Build'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { normalizeRoleToolPolicy } from '../../domain/toolPolicy'
import { toolCatalogByName, toolCatalogItems } from '../../domain/toolCatalog'

type RoleNativeToolsSectionProps = {
  controller: any
  draft: any
  tools: any
}

export function RoleNativeToolsSection(props: RoleNativeToolsSectionProps) {
  const { controller, draft, tools } = props
  const policy = normalizeRoleToolPolicy(draft?.roleToolPolicy)
  const catalogItems = toolCatalogItems(tools)
  const catalogByName = toolCatalogByName(catalogItems)
  const selectedSet = new Set(policy.nativeTools)
  const candidates = policy.tools.filter((toolName) => !selectedSet.has(toolName))

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5, width: { xs: '100%', md: 340 }, bgcolor: 'rgba(103,58,183,.045)' }}>
      <Stack spacing={1.25} sx={{ height: '100%' }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: 'rgba(103,58,183,.12)', color: 'secondary.main', display: 'grid', placeItems: 'center' }}>
            <BuildIcon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 900 }}>原生 tools 传递</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              只把这里选择的白名单工具写入供应商 tools 字段。
            </Typography>
          </Box>
          <Chip size="small" color={policy.nativeTools.length ? 'secondary' : 'default'} label={`${policy.nativeTools.length} 个`} />
          <IconButton size="small" onClick={() => controller.actions.openRoleNativeToolAdd()} disabled={!candidates.length} aria-label="添加原生 tools 传递">
            <AddIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack spacing={0.75} sx={{ flex: 1 }}>
          {policy.nativeTools.length ? (
            policy.nativeTools.map((toolName) => {
              const tool = catalogByName.get(toolName)
              return (
                <Paper key={toolName} variant="outlined" sx={{ px: 1, py: 0.75, borderRadius: 1.75, bgcolor: 'background.paper' }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 900 }} noWrap>
                        {toolName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {String(tool?.description || '白名单内工具')}
                      </Typography>
                    </Box>
                    <IconButton size="small" onClick={() => controller.actions.removeRoleNativeTool(toolName)} aria-label={`移除原生 tools 传递 ${toolName}`}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Paper>
              )
            })
          ) : (
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.75, bgcolor: 'rgba(255,255,255,.72)' }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>
                默认不传递任何原生工具
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                这里仅控制写入供应商 tools 字段的工具名单。
              </Typography>
            </Paper>
          )}
        </Stack>
      </Stack>

      <Dialog open={!!draft?.roleNativeToolAddOpen} onClose={() => controller.actions.closeRoleNativeToolAdd()} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AddIcon fontSize="small" />
          添加原生 tools 传递
          <Box sx={{ flex: 1 }} />
          <IconButton onClick={() => controller.actions.closeRoleNativeToolAdd()} size="small" aria-label="关闭原生 tools 添加">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            {candidates.length ? (
              candidates.map((toolName) => {
                const tool = catalogByName.get(toolName)
                return (
                  <Paper key={toolName} variant="outlined" sx={{ p: 1.25, borderRadius: 2, cursor: 'pointer' }} onClick={() => controller.actions.addRoleNativeTool(toolName)}>
                    <Stack direction="row" spacing={1.25} alignItems="flex-start">
                      <Box sx={{ width: 34, height: 34, borderRadius: 1.5, bgcolor: 'grey.100', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
                        <BuildIcon fontSize="small" />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                          <Typography sx={{ fontWeight: 900 }}>{toolName}</Typography>
                          {String(tool?.type || '').trim() ? <Chip size="small" variant="outlined" label={String(tool?.type || '')} /> : null}
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {String(tool?.description || '白名单内工具')}
                        </Typography>
                      </Box>
                    </Stack>
                  </Paper>
                )
              })
            ) : (
              <Paper variant="outlined" sx={{ p: 3, borderRadius: 2.5, textAlign: 'center', bgcolor: 'grey.50' }}>
                <Typography sx={{ fontWeight: 900 }}>没有可添加的原生工具</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  请先把工具加入白名单，或当前白名单工具已经全部加入原生传递名单。
                </Typography>
              </Paper>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => controller.actions.closeRoleNativeToolAdd()}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
