import * as React from 'react'
import { Button, Chip, IconButton, Stack, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { normalizeModelRef } from '../../domain/modelRefUtils'
import { modelCandidateKey, normalizeRoleModelCandidates } from '../../domain/roleModelCandidates'
import { ModelSourcePicker } from '../components/ModelSourcePicker'
import { RoleModelCandidateList } from '../components/RoleModelCandidateList'

// 角色模型区块：上半部分挑选并加入候选模型，下半部分是候选池与默认选择。
// 候选池是角色模型的唯一事实源，默认选择只是池内一项的引用。
export function RoleModelSection(props: { controller: any; providers: any[]; modelGroups: any[]; draft: any; models: any }) {
  const { controller, providers, modelGroups, draft, models } = props

  const modelSource = String(draft?.roleModelSource || '') === 'model_group' ? 'model_group' : 'provider'
  const providerId = String(draft?.roleProviderId || '')
  const modelGroupId = String(draft?.roleModelGroupId || '')
  const modelPick = modelSource === 'model_group' ? String(draft?.roleModelGroupModelId || '') : String(draft?.roleModelId || '')

  const candidates = normalizeRoleModelCandidates(draft?.roleModelCandidates)
  const defaultId = String(draft?.roleDefaultModelCandidateId || '')
  const pickedRef = normalizeModelRef(modelSource === 'model_group'
    ? { kind: 'model_group', providerId: '', groupId: modelGroupId, modelId: modelPick }
    : { kind: 'provider', providerId, groupId: '', modelId: modelPick })
  const pickedAlreadyInPool = !!pickedRef && candidates.some((candidate) => modelCandidateKey(candidate) === modelCandidateKey(pickedRef))

  return (
    <Stack spacing={1.5}>
      <ModelSourcePicker
        value={{ kind: modelSource, providerId, groupId: modelGroupId, modelId: modelPick }}
        providers={providers}
        modelGroups={modelGroups}
        onSourceChanged={(kind) => controller.actions.roleModelSourceChanged?.(kind)}
        onProviderChanged={(next) => controller.actions.roleProviderChanged(next)}
        onModelGroupChanged={(next) => controller.actions.roleModelGroupChanged?.(next)}
        onModelChanged={(next) => controller.actions.roleModelChanged(next)}
        trailing={(
          <Button
            variant="outlined"
            sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'center' } }}
            disabled={!pickedRef || pickedAlreadyInPool}
            onClick={() => controller.actions.addRoleModelCandidate?.()}
          >
            {pickedAlreadyInPool ? '已在候选池' : '加入候选池'}
          </Button>
        )}
      />

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

      <RoleModelCandidateList
        candidates={candidates}
        providers={providers}
        modelGroups={modelGroups}
        highlightedKey={defaultId}
        highlightLabel="默认模型"
        emptyHint="还没有候选模型。先在上面选择模型并加入候选池。"
        renderTrailing={(_candidate, key, highlighted) => (
          <>
            {highlighted ? (
              <Chip size="small" color="primary" label="默认" />
            ) : (
              <Button size="small" variant="text" startIcon={<StarBorderIcon fontSize="small" />} onClick={() => controller.actions.setDefaultRoleModelCandidate?.(key)}>
                设为默认
              </Button>
            )}
            <IconButton size="small" aria-label="从候选池移除" onClick={() => controller.actions.removeRoleModelCandidate?.(key)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </>
        )}
      />
    </Stack>
  )
}
