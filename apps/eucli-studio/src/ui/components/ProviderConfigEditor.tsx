import * as React from 'react'
import { Box, Button, Divider, FormControl, FormControlLabel, InputLabel, MenuItem, Paper, Select, Stack, Switch, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import { ApiKeyField } from './fields/ApiKeyField'
import { REASONING_EFFORT_OPTIONS } from '../../domain/reasoning'

type ProviderConfigEditorProps = {
  controller: any
  draft: any
  provider: any
  loading?: boolean
  models?: any
}

export function ProviderConfigEditor(props: ProviderConfigEditorProps) {
  const { controller, draft, provider, loading, models } = props
  const providerId = String(provider?.id || draft?.editProviderId || '')
  const apiKeys = Array.isArray(draft?.providerApiKeys) ? draft.providerApiKeys : []
  const registeredModels = Array.isArray(draft?.providerRegisteredModels) ? draft.providerRegisteredModels : []
  const rawModels = Array.isArray(provider?.modelsCache?.items) ? provider.modelsCache.items.map((item: any) => String(item || '')).filter(Boolean) : []
  const busy = !!loading || !!models?.loading

  const setDraft = (key: string, value: any) => controller.actions.setDraft(key, value)

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
    setDraft('providerRegisteredModels', [...registeredModels, { id, name: id, sourceModelId }])
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
        <Select labelId={`provider-editor-protocol-${providerId || 'new'}`} label="协议" value={String(draft?.providerProtocol || '')} onChange={(e) => setDraft('providerProtocol', e.target.value)}>
          <MenuItem value=""><em>请选择协议</em></MenuItem>
          <MenuItem value="openai">OpenAI 兼容</MenuItem>
          <MenuItem value="anthropic">Anthropic</MenuItem>
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
                  <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => removeApiKey(index)}>删除</Button>
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

          {registeredModels.length ? registeredModels.map((item: any, index: number) => (
            <Paper key={`${String(item?.id || '')}-${index}`} variant="outlined" sx={{ p: 1, bgcolor: 'grey.50' }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
                <TextField size="small" label="自定义模型 ID" value={String(item?.id || '')} onChange={(e) => updateRegisteredModel(index, { id: e.target.value })} sx={{ flex: 1 }} />
                <TextField size="small" label="显示名称" value={String(item?.name || '')} onChange={(e) => updateRegisteredModel(index, { name: e.target.value })} sx={{ flex: 1 }} />
                <FormControl size="small" sx={{ flex: 1, minWidth: 180 }}>
                  <InputLabel>映射原始模型</InputLabel>
                  <Select label="映射原始模型" value={String(item?.sourceModelId || '')} onChange={(e) => updateRegisteredModel(index, { sourceModelId: e.target.value })}>
                    <MenuItem value=""><em>请选择模型</em></MenuItem>
                    {rawModels.map((id: string) => <MenuItem key={id} value={id}>{id}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControlLabel control={<Switch checked={!!item?.supportsReasoning} onChange={(e) => updateRegisteredModel(index, { supportsReasoning: e.target.checked })} />} label="可推理" />
                {item?.supportsReasoning ? (
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>默认思考</InputLabel>
                    <Select label="默认思考" value={String(item?.defaultReasoningEffort || 'medium')} onChange={(e) => updateRegisteredModel(index, { defaultReasoningEffort: e.target.value })}>
                      {REASONING_EFFORT_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                ) : null}
                <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => removeRegisteredModel(index)}>删除</Button>
              </Stack>
            </Paper>
          )) : (
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
