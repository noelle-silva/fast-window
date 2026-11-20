import * as React from 'react'
import { Box, Button, Divider, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Switch, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import RefreshIcon from '@mui/icons-material/Refresh'
import { arrayMove } from '@dnd-kit/sortable'
import { ApiKeyField } from './fields/ApiKeyField'
import { MoreActionsMenu } from './MoreActionsMenu'
import { SortableList } from './SortableList'
import { resolveCapabilitySelection } from '../../domain/providerCapabilities'

type ProviderConfigEditorProps = {
  controller: any
  draft: any
  provider: any
  loading?: boolean
  models?: any
  // providerCapabilities 是业务端声明的协议与思考档位清单：
  // 客户端不持有枚举，拿不到时下拉只显示已保存的值。
  providerCapabilities?: { protocols?: any[]; reasoningEfforts?: any[] }
}

export function ProviderConfigEditor(props: ProviderConfigEditorProps) {
  const { controller, draft, provider, loading, models, providerCapabilities } = props
  // 身份只来自实体：草稿态没有 id 时，刷新模型等实体操作必须保持不可用。
  const providerId = String(provider?.id || '')
  const apiKeys = Array.isArray(draft?.providerApiKeys) ? draft.providerApiKeys : []
  const registeredModels = Array.isArray(draft?.providerRegisteredModels) ? draft.providerRegisteredModels : []
  const rawModels = Array.isArray(provider?.modelsCache?.items) ? provider.modelsCache.items.map((item: any) => String(item || '')).filter(Boolean) : []
  const busy = !!loading || !!models?.loading

  const setDraft = (key: string, value: any) => controller.actions.setDraft(key, value)

  // 协议与思考档位的取值域由业务端声明，客户端只渲染拿到的清单。
  // 清单缺席时 selected 会退化成「只显示已保存的值」，绝不编造选项。
  const protocolSelection = React.useMemo(
    () => resolveCapabilitySelection(providerCapabilities?.protocols || [], draft?.providerProtocol),
    [providerCapabilities?.protocols, draft?.providerProtocol],
  )
  const reasoningEffortOptions = providerCapabilities?.reasoningEfforts || []

  // 拖拽排序需要稳定且唯一的条目键：自定义 ID 正常唯一，编辑中空值或重复时补后缀兜底。
  const registeredModelSortIds = React.useMemo(() => {
    const seen = new Map<string, number>()
    return registeredModels.map((model: any) => {
      const base = String(model?.id || '').trim() || '未命名模型'
      const count = seen.get(base) || 0
      seen.set(base, count + 1)
      return count ? `${base}#${count}` : base
    })
  }, [registeredModels])

  // 排序只改草稿，落库仍旧走供应商保存，与其它字段的修改语义一致。
  const moveRegisteredModel = (activeId: string, overId: string) => {
    const from = registeredModelSortIds.indexOf(activeId)
    const to = registeredModelSortIds.indexOf(overId)
    if (from < 0 || to < 0 || from === to) return
    setDraft('providerRegisteredModels', arrayMove(registeredModels, from, to))
  }

  const updateApiKey = (index: number, patch: Record<string, any>) => {
    setDraft('providerApiKeys', apiKeys.map((item: any, idx: number) => idx === index ? { ...item, ...patch } : item))
  }

  const addApiKey = () => {
    setDraft('providerApiKeys', [...apiKeys, { id: makeClientId('key'), name: `Key ${apiKeys.length + 1}`, key: '', enabled: true, weight: 1 }])
  }

  const removeApiKey = (index: number) => {
    setDraft('providerApiKeys', apiKeys.filter((_item: any, idx: number) => idx !== index))
  }

  const updateRegisteredModel = (index: number, patch: Record<string, any>) => {
    setDraft('providerRegisteredModels', registeredModels.map((item: any, idx: number) => idx === index ? { ...item, ...patch } : item))
  }

  const addRegisteredModel = () => {
    const used = new Set(registeredModels.map((item: any) => String(item?.sourceModelId || '')).filter(Boolean))
    const sourceModelId = rawModels.find((id: string) => !used.has(id)) || rawModels[0] || ''
    const id = sourceModelId ? uniqueModelId(sourceModelId, registeredModels) : makeClientId('model')
    setDraft('providerRegisteredModels', [...registeredModels, { id, sourceModelId }])
  }

  const selectRegisteredModelSource = (index: number, sourceModelId: string) => {
    if (!sourceModelId) {
      updateRegisteredModel(index, { sourceModelId })
      return
    }
    const siblings = registeredModels.filter((_item: any, idx: number) => idx !== index)
    updateRegisteredModel(index, { sourceModelId, id: uniqueModelId(sourceModelId, siblings) })
  }

  const removeRegisteredModel = (index: number) => {
    setDraft('providerRegisteredModels', registeredModels.filter((_item: any, idx: number) => idx !== index))
  }

  return (
    <Stack spacing={1.5}>
      <TextField label="名称" value={String(draft?.providerName || '')} onChange={(e) => setDraft('providerName', e.target.value)} />
      <TextField label="Base URL" value={String(draft?.providerBaseUrl || '')} onChange={(e) => setDraft('providerBaseUrl', e.target.value)} placeholder="https://api.openai.com/v1" />

      <FormControl fullWidth>
        <InputLabel id={`provider-editor-protocol-${providerId || 'new'}`}>协议</InputLabel>
        <Select labelId={`provider-editor-protocol-${providerId || 'new'}`} label="协议" value={protocolSelection.value} onChange={(e) => setDraft('providerProtocol', e.target.value)}>
          <MenuItem value=""><em>请选择协议</em></MenuItem>
          {protocolSelection.options.map((option: any) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
        <Stack spacing={1.25}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900 }}>供应商 Key</Typography>
              <Typography variant="caption" color="text.secondary">只有启用的 Key 会参与请求轮询。</Typography>
            </Box>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Key 策略</InputLabel>
              <Select label="Key 策略" value={String(draft?.providerApiKeyStrategy || 'sequential')} onChange={(e) => setDraft('providerApiKeyStrategy', e.target.value)}>
                <MenuItem value="sequential">顺序轮询</MenuItem>
                <MenuItem value="weighted_random">权重随机</MenuItem>
              </Select>
            </FormControl>
            <Button size="small" startIcon={<AddIcon />} onClick={addApiKey}>添加 Key</Button>
          </Stack>

          {apiKeys.length ? apiKeys.map((item: any, index: number) => (
            <Paper key={String(item?.id || index)} variant="outlined" sx={{ p: 1, bgcolor: 'grey.50' }}>
              <Stack spacing={1}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <TextField size="small" label="Key 名称" value={String(item?.name || '')} onChange={(e) => updateApiKey(index, { name: e.target.value })} sx={{ flex: 1 }} />
                  <TextField size="small" label="权重" type="number" value={String(item?.weight || 1)} onChange={(e) => updateApiKey(index, { weight: e.target.value })} inputProps={{ min: 1, step: 1 }} sx={{ width: { xs: '100%', sm: 120 } }} />
                  <FormControlLabel control={<Switch checked={item?.enabled !== false} onChange={(e) => updateApiKey(index, { enabled: e.target.checked })} />} label="启用" />
                  <MoreActionsMenu
                    items={[{
                      key: 'delete',
                      label: '删除',
                      icon: <DeleteOutlineIcon fontSize="small" />,
                      danger: true,
                      confirm: {
                        title: '确认删除 Key？',
                        description: `将从供应商配置中移除「${String(item?.name || `Key ${index + 1}`)}」，保存供应商后生效。`,
                      },
                      onSelect: () => removeApiKey(index),
                    }]}
                  />
                </Stack>
                <ApiKeyField value={String(item?.key || '')} onValueChange={(next) => updateApiKey(index, { key: next })} />
              </Stack>
            </Paper>
          )) : (
            <Typography variant="body2" color="text.secondary">暂无 Key，请先添加至少一个 Key。</Typography>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
        <Stack spacing={1.25}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900 }}>正式登记模型</Typography>
              <Typography variant="caption" color="text.secondary">角色只能选择这里登记后的模型，不直接使用原始模型列表。</Typography>
            </Box>
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => controller.actions.refreshModels(providerId, true)} disabled={!providerId || busy}>{models?.loading ? '刷新中…' : '刷新列表'}</Button>
            <Button size="small" startIcon={<AddIcon />} onClick={addRegisteredModel} disabled={!rawModels.length}>登记模型</Button>
          </Stack>

          {rawModels.length ? null : (
            <Typography variant="caption" color="text.secondary">请先保存供应商 Key 后刷新模型列表，再从原始列表登记正式模型。</Typography>
          )}

          {registeredModels.length ? (
            <SortableList ids={registeredModelSortIds} onMove={moveRegisteredModel} disabled={busy}>
              {({ index, drag }) => {
                const item = registeredModels[index]
                const missingSourceModel = !String(item?.sourceModelId || '').trim()
                return (
                  <Paper
                    ref={drag.setNodeRef as any}
                    style={drag.style}
                    variant="outlined"
                    sx={{
                      p: 1,
                      bgcolor: 'grey.50',
                      opacity: drag.isDragging ? 0.65 : 1,
                      boxShadow: drag.isDragging ? 3 : undefined,
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="flex-start">
                      <IconButton
                        ref={drag.setHandleRef as any}
                        {...drag.handleProps}
                        size="small"
                        aria-label="拖拽排序"
                        sx={{ mt: 0.5, cursor: drag.isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                      >
                        <DragIndicatorIcon fontSize="small" />
                      </IconButton>
                      <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
                        <Stack spacing={1}>
                          <TextField size="small" label="自定义模型 ID" fullWidth value={String(item?.id || '')} onChange={(e) => updateRegisteredModel(index, { id: e.target.value })} />
                          <FormControl size="small" fullWidth error={missingSourceModel}>
                            <InputLabel>映射原始模型</InputLabel>
                            <Select label="映射原始模型" value={String(item?.sourceModelId || '')} onChange={(e) => selectRegisteredModelSource(index, e.target.value)}>
                              <MenuItem value=""><em>请选择模型</em></MenuItem>
                              {rawModels.map((id: string) => <MenuItem key={id} value={id}>{id}</MenuItem>)}
                            </Select>
                          </FormControl>
                          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                            <FormControlLabel sx={{ m: 0 }} control={<Switch checked={!!item?.supportsReasoning} onChange={(e) => updateRegisteredModel(index, { supportsReasoning: e.target.checked })} />} label="可推理" />
                            {item?.supportsReasoning ? (
                              <FormControl size="small" sx={{ flex: 1, minWidth: 160 }}>
                                <InputLabel>默认思考</InputLabel>
                                <Select label="默认思考" value={String(item?.defaultReasoningEffort || '')} onChange={(e) => updateRegisteredModel(index, { defaultReasoningEffort: e.target.value })}>
                                  {resolveCapabilitySelection(reasoningEffortOptions, item?.defaultReasoningEffort).options.map((option: any) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </Select>
                              </FormControl>
                            ) : null}
                            <MoreActionsMenu
                              items={[{
                                key: 'delete',
                                label: '删除',
                                icon: <DeleteOutlineIcon fontSize="small" />,
                                danger: true,
                                confirm: {
                                  title: '确认删除登记模型？',
                                  description: `将移除「${String(item?.id || '该模型')}」，保存供应商后生效。`,
                                },
                                onSelect: () => removeRegisteredModel(index),
                              }]}
                            />
                          </Stack>
                        </Stack>
                        {missingSourceModel ? (
                          <Typography variant="caption" color="error">未选择映射原始模型，保存前必须补全。</Typography>
                        ) : null}
                      </Stack>
                    </Stack>
                  </Paper>
                )
              }}
            </SortableList>
          ) : (
            <Typography variant="body2" color="text.secondary">暂无登记模型。</Typography>
          )}

          <Divider />
          <Typography variant="caption" color="text.secondary">保存供应商后，登记模型会作为角色和模型组可引用的正式模型清单。</Typography>
        </Stack>
      </Paper>
    </Stack>
  )
}

function makeClientId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function uniqueModelId(sourceModelId: string, existing: any[]) {
  const used = new Set((Array.isArray(existing) ? existing : []).map((item: any) => String(item?.id || '')).filter(Boolean))
  const base = String(sourceModelId || 'model').replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'model'
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}-${index}`)) index++
  return `${base}-${index}`
}
