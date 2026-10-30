import * as React from 'react'
import { Box, Button, Chip, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { formatModelRefDisplayText, normalizeModelRef } from '../../domain/modelRefUtils'
import { modelCandidateKey, normalizeRoleModelCandidates } from '../../domain/roleModelCandidates'
import { modelGroupModelItems, registeredModelItems } from '../settings/modelItemSelectors'

// 角色模型区块：上半部分挑选并加入候选模型，下半部分是候选池与默认选择。
// 候选池是角色模型的唯一事实源，默认选择只是池内一项的引用。
export function RoleModelSection(props: { controller: any; providers: any[]; modelGroups: any[]; draft: any; models: any }) {
  const { controller, providers, modelGroups, draft, models } = props

  const providerId = String(draft?.roleProviderId || '')
  const modelSource = String(draft?.roleModelSource || '') === 'model_group' ? 'model_group' : 'provider'
  const modelGroupId = String(draft?.roleModelGroupId || '')

  const provider = providers.find((p: any) => String(p?.id || '') === providerId) || null
  const modelGroup = modelGroups.find((group: any) => String(group?.id || '') === modelGroupId) || null
  const modelItems = modelSource === 'model_group' ? modelGroupModelItems(modelGroup) : registeredModelItems(provider)
  const modelPick = modelSource === 'model_group' ? String(draft?.roleModelGroupModelId || '') : String(draft?.roleModelId || '')
  const hasPickInList = !!modelPick && modelItems.some((item: any) => item.id === modelPick)

  const candidates = normalizeRoleModelCandidates(draft?.roleModelCandidates)
  const defaultId = String(draft?.roleDefaultModelCandidateId || '')
  const pickedRef = normalizeModelRef(modelSource === 'model_group'
    ? { kind: 'model_group', providerId: '', groupId: modelGroupId, modelId: modelPick }
    : { kind: 'provider', providerId, groupId: '', modelId: modelPick })
  const pickedAlreadyInPool = !!pickedRef && candidates.some((candidate) => modelCandidateKey(candidate) === modelCandidateKey(pickedRef))

  return (
    <Stack spacing={1.5}>
      <FormControl fullWidth>
        <InputLabel>模型来源</InputLabel>
        <Select label="模型来源" value={modelSource} onChange={(e) => controller.actions.roleModelSourceChanged?.(e.target.value)}>
          <MenuItem value="provider">供应商模型</MenuItem>
          <MenuItem value="model_group">模型组</MenuItem>
        </Select>
      </FormControl>

      {modelSource === 'provider' ? (
        <FormControl fullWidth>
          <InputLabel>供应商</InputLabel>
          <Select label="供应商" value={providerId} onChange={(e) => controller.actions.roleProviderChanged(e.target.value)}>
            {providers.map((p: any) => (
              <MenuItem key={String(p?.id || '')} value={String(p?.id || '')}>
                {String(p?.name || '')}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ) : (
        <FormControl fullWidth>
          <InputLabel>模型组</InputLabel>
          <Select label="模型组" value={modelGroupId} onChange={(e) => controller.actions.roleModelGroupChanged?.(e.target.value)}>
            {modelGroups.map((group: any) => (
              <MenuItem key={String(group?.id || '')} value={String(group?.id || '')}>
                {String(group?.name || '')}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <FormControl fullWidth>
          <InputLabel>模型</InputLabel>
          <Select label="模型" value={modelPick} onChange={(e) => controller.actions.roleModelChanged(e.target.value)}>
            <MenuItem value="">请选择模型</MenuItem>
            {!hasPickInList && modelPick ? <MenuItem value={modelPick}>{modelPick}</MenuItem> : null}
            {modelItems.map((item: any) => (
              <MenuItem key={item.id} value={item.id}>
                {item.hint ? `${item.label} / ${item.hint}` : item.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'center' } }}
          disabled={!pickedRef || pickedAlreadyInPool}
          onClick={() => controller.actions.addRoleModelCandidate?.()}
        >
          {pickedAlreadyInPool ? '已在候选池' : '加入候选池'}
        </Button>
      </Stack>

      {modelSource === 'provider' ? (
        <Typography variant="caption" color="text.secondary">
          仅显示供应商设置中已登记的模型；原始模型列表请到供应商设置中刷新并登记。
        </Typography>
      ) : null}

      {models?.error ? (
        <Typography variant="body2" color="error">
          {String(models.error || '')}
        </Typography>
      ) : null}

      <Typography variant="body2" sx={{ fontWeight: 900 }}>
        候选模型（{candidates.length}）
      </Typography>

      {candidates.length ? (
        <Stack spacing={1}>
          {candidates.map((candidate) => {
            const key = modelCandidateKey(candidate)
            const isDefault = key === defaultId
            return (
              <Paper key={key} elevation={0} sx={{ p: 1, borderRadius: 2, bgcolor: 'var(--studio-paper-muted)', border: isDefault ? '1px solid var(--studio-primary)' : '1px solid transparent' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                      {formatModelRefDisplayText(candidate, providers, modelGroups) || candidate.modelId}
                    </Typography>
                    {isDefault ? (
                      <Typography variant="caption" color="text.secondary">
                        默认模型
                      </Typography>
                    ) : null}
                  </Box>
                  {isDefault ? (
                    <Chip size="small" color="primary" label="默认" />
                  ) : (
                    <Button size="small" variant="text" startIcon={<StarBorderIcon fontSize="small" />} onClick={() => controller.actions.setDefaultRoleModelCandidate?.(key)}>
                      设为默认
                    </Button>
                  )}
                  <IconButton size="small" aria-label="从候选池移除" onClick={() => controller.actions.removeRoleModelCandidate?.(key)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Paper>
            )
          })}
        </Stack>
      ) : (
        <Stack direction="row" spacing={1} alignItems="center">
          <StarIcon fontSize="small" sx={{ opacity: 0.35 }} />
          <Typography variant="body2" color="text.secondary">
            还没有候选模型。先在上面选择模型并加入候选池。
          </Typography>
        </Stack>
      )}
    </Stack>
  )
}
