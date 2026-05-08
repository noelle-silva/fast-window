import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import { Box, Button, Chip, Dialog, Divider, IconButton, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { createDefaultTemplate, nowMs } from '../../shared/aiOnceDomain'
import type { AiOnceController } from '../hooks/useAiOnceController'

type TemplatesDialogProps = {
  controller: AiOnceController
}

export function TemplatesDialog(props: TemplatesDialogProps) {
  const { controller } = props
  const editing = controller.state.editing
  const spaceId = controller.currentSpace?.id || editing?.spaces[0]?.id || ''
  const space = editing?.spaces.find(item => item.id === spaceId) || editing?.spaces[0]
  const open = controller.state.dialog === 'templates' && !!editing && !!space

  return (
    <Dialog open={open} onClose={controller.closeDialog} fullWidth maxWidth="md" PaperProps={{ sx: { maxHeight: 'min(88vh, 820px)', overflow: 'hidden' } }}>
      {editing && space ? (
        <Box sx={{ p: { xs: 1.5, sm: 2 }, overflow: 'auto' }}>
          <Stack spacing={1.5}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>模板管理：{space.name}</Typography>
              <Typography variant="body2" color="text.secondary">模板负责系统提示词，当前空间至少保留一个模板。</Typography>
            </Box>

            <Stack spacing={1}>
              {space.templates.map(template => (
                <Paper key={template.id} sx={{ p: 1.25, borderRadius: 2.5, boxShadow: 'inset 0 0 0 1px rgba(100, 116, 139, 0.14)' }}>
                  <Stack spacing={1}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                      <TextField
                        label="模板名称"
                        value={template.name}
                        onChange={event => controller.mutateEditing(draft => {
                          const targetSpace = draft.spaces.find(item => item.id === space.id)
                          const hit = targetSpace?.templates.find(item => item.id === template.id)
                          if (hit) hit.name = event.target.value
                          if (targetSpace) targetSpace.updatedAt = nowMs()
                        })}
                        sx={{ flex: 1 }}
                      />
                      <Button
                        startIcon={<StarRoundedIcon fontSize="small" />}
                        variant={space.activeTemplateId === template.id ? 'contained' : 'text'}
                        onClick={() => controller.mutateEditing(draft => {
                          const targetSpace = draft.spaces.find(item => item.id === space.id)
                          if (targetSpace) {
                            targetSpace.activeTemplateId = template.id
                            targetSpace.updatedAt = nowMs()
                          }
                        })}
                      >
                        {space.activeTemplateId === template.id ? '当前' : '切换'}
                      </Button>
                      <Tooltip title={space.templates.length <= 1 ? '至少保留一个模板' : '删除模板'}>
                        <span>
                          <IconButton
                            color="error"
                            disabled={space.templates.length <= 1}
                            aria-label={`删除模板 ${template.name}`}
                            onClick={() => controller.mutateEditing(draft => {
                              const targetSpace = draft.spaces.find(item => item.id === space.id)
                              if (!targetSpace || targetSpace.templates.length <= 1) return
                              targetSpace.templates = targetSpace.templates.filter(item => item.id !== template.id)
                              if (targetSpace.activeTemplateId === template.id) targetSpace.activeTemplateId = targetSpace.templates[0].id
                              targetSpace.updatedAt = nowMs()
                            })}
                          >
                            <DeleteOutlineRoundedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                    <TextField
                      label="系统提示词"
                      value={template.systemPrompt}
                      onChange={event => controller.mutateEditing(draft => {
                        const targetSpace = draft.spaces.find(item => item.id === space.id)
                        const hit = targetSpace?.templates.find(item => item.id === template.id)
                        if (hit) hit.systemPrompt = event.target.value
                        if (targetSpace) targetSpace.updatedAt = nowMs()
                      })}
                      multiline
                      minRows={4}
                      fullWidth
                    />
                    {space.activeTemplateId === template.id ? <Chip size="small" color="success" label="当前模板" sx={{ alignSelf: 'flex-start' }} /> : null}
                  </Stack>
                </Paper>
              ))}
            </Stack>

            <Divider />

            <Stack direction="row" spacing={1} justifyContent="space-between" flexWrap="wrap">
              <Button
                startIcon={<AddRoundedIcon fontSize="small" />}
                onClick={() => controller.mutateEditing(draft => {
                  const targetSpace = draft.spaces.find(item => item.id === space.id)
                  if (!targetSpace) return
                  const next = createDefaultTemplate()
                  next.name = '新模板'
                  targetSpace.templates.unshift(next)
                  targetSpace.activeTemplateId = next.id
                  targetSpace.updatedAt = nowMs()
                })}
              >
                新增模板
              </Button>
              <Stack direction="row" spacing={1}>
                <Button onClick={controller.closeDialog}>取消</Button>
                <Button variant="contained" startIcon={<SaveRoundedIcon fontSize="small" />} onClick={() => void controller.saveEditing()} disabled={controller.state.busy}>
                  保存
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </Box>
      ) : null}
    </Dialog>
  )
}
