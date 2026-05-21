import * as React from 'react'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import { Box, Button, Chip, Collapse, Dialog, Divider, FormControlLabel, IconButton, Paper, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material'
import { createDefaultTemplate, effectiveHistorySettings, normalizeHistoryLimit, nowMs } from '../../shared/aiOnceDomain'
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
  const historySettings = effectiveHistorySettings(space || null, editing?.settings.history)
  const [expandedTemplateId, setExpandedTemplateId] = React.useState('')

  React.useEffect(() => {
    if (!open || !space) return
    if (!space.templates.some(template => template.id === expandedTemplateId)) {
      setExpandedTemplateId(space.activeTemplateId || space.templates[0]?.id || '')
    }
  }, [expandedTemplateId, open, space])

  return (
    <Dialog open={open} onClose={controller.closeDialog} fullWidth maxWidth="md" PaperProps={{ sx: { height: 'min(88vh, 820px)', maxHeight: 'min(88vh, 820px)', overflow: 'hidden' } }}>
      {editing && space ? (
        <Box sx={{ p: { xs: 1.5, sm: 2 }, height: '100%', overflow: 'hidden' }}>
          <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900 }}>空间编辑</Typography>
              <Typography variant="body2" color="text.secondary">编辑空间名称，并维护这个空间的提示词模板。</Typography>
            </Box>

            <TextField
              label="空间名称"
              value={space.name}
              onChange={event => controller.mutateEditing(draft => {
                const targetSpace = draft.spaces.find(item => item.id === space.id)
                if (!targetSpace) return
                targetSpace.name = event.target.value
                targetSpace.updatedAt = nowMs()
              })}
              fullWidth
            />

            <Paper sx={{ p: 1.25, borderRadius: 2.5, boxShadow: 'inset 0 0 0 1px rgba(100, 116, 139, 0.14)' }}>
              <Stack spacing={1}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>历史策略</Typography>
                  <Typography variant="body2" color="text.secondary">默认跟随全局设置；开启覆盖后，此空间使用自己的记录规则。</Typography>
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <FormControlLabel
                    control={<Switch checked={space.history.override} onChange={event => controller.mutateEditing(draft => {
                      const targetSpace = draft.spaces.find(item => item.id === space.id)
                      if (!targetSpace) return
                      targetSpace.history.override = event.target.checked
                      if (event.target.checked) {
                        targetSpace.history.enabled = historySettings.enabled
                        targetSpace.history.limit = historySettings.limit
                      }
                      targetSpace.updatedAt = nowMs()
                    })} />}
                    label="覆盖全局"
                  />
                  <FormControlLabel
                    control={<Switch checked={historySettings.enabled} disabled={!space.history.override} onChange={event => controller.mutateEditing(draft => {
                      const targetSpace = draft.spaces.find(item => item.id === space.id)
                      if (!targetSpace) return
                      targetSpace.history.enabled = event.target.checked
                      targetSpace.updatedAt = nowMs()
                    })} />}
                    label="记录历史"
                  />
                  <TextField
                    label="记录上限"
                    type="number"
                    size="small"
                    disabled={!space.history.override}
                    inputProps={{ min: 1 }}
                    value={historySettings.limit}
                    onChange={event => controller.mutateEditing(draft => {
                      const targetSpace = draft.spaces.find(item => item.id === space.id)
                      if (!targetSpace) return
                      targetSpace.history.limit = normalizeHistoryLimit(Number(event.target.value))
                      targetSpace.updatedAt = nowMs()
                    })}
                    sx={{ maxWidth: { sm: 160 } }}
                  />
                </Stack>
              </Stack>
            </Paper>

            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>提示词模板</Typography>

            <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflow: 'auto', pr: 0.5 }}>
              {space.templates.map(template => (
                <Paper key={template.id} sx={{ p: 1.25, borderRadius: 2.5, boxShadow: 'inset 0 0 0 1px rgba(100, 116, 139, 0.14)' }}>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Button
                        endIcon={<ExpandMoreRoundedIcon fontSize="small" sx={{ transform: expandedTemplateId === template.id ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease' }} />}
                        onClick={() => setExpandedTemplateId(prev => prev === template.id ? '' : template.id)}
                        sx={{ flex: 1, minWidth: 0, justifyContent: 'space-between' }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 900, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{template.name}</Typography>
                      </Button>
                      {space.activeTemplateId === template.id ? <Chip size="small" color="success" label="当前" /> : null}
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
                    <Collapse in={expandedTemplateId === template.id} timeout="auto" unmountOnExit>
                      <Stack spacing={1} sx={{ pt: 0.5 }}>
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
                            {space.activeTemplateId === template.id ? '当前模板' : '设为当前'}
                          </Button>
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
                      </Stack>
                    </Collapse>
                  </Stack>
                </Paper>
              ))}
            </Stack>

            <Divider />

            <Stack direction="row" spacing={1} justifyContent="space-between" flexWrap="wrap">
              <Button
                startIcon={<AddRoundedIcon fontSize="small" />}
                onClick={() => {
                  const next = createDefaultTemplate()
                  next.name = '新模板'
                  controller.mutateEditing(draft => {
                    const targetSpace = draft.spaces.find(item => item.id === space.id)
                    if (!targetSpace) return
                    targetSpace.templates.unshift(next)
                    targetSpace.activeTemplateId = next.id
                    targetSpace.updatedAt = nowMs()
                  })
                  setExpandedTemplateId(next.id)
                }}
              >
                新增模板
              </Button>
              <Stack direction="row" spacing={1}>
                <Button onClick={controller.closeDialog}>取消</Button>
                <Button variant="contained" startIcon={<SaveRoundedIcon fontSize="small" />} onClick={() => void controller.saveEditing()} disabled={controller.state.busy || controller.state.asking}>
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
