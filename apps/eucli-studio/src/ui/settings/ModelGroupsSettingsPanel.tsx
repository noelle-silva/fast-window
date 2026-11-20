import * as React from 'react'
import { Box, Button, FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Select, Stack, Switch, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import { resolveModelGroupStrategySelection, type ModelGroupStrategyOption } from '../../domain/modelGroupStrategies'
import { resolveCapabilitySelection, type CapabilityOption } from '../../domain/providerCapabilities'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { SortableList } from '../components/SortableList'
import { resolveSortMovePosition, type SortMovePosition } from '../components/SortableDnd'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { SettingsHeading, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type ModelGroupsSettingsPanelProps = {
  controller: any
  loading: boolean
  modelGroups: any
  providers: any[]
  // providerCapabilities 是业务端声明的思考档位清单：客户端不持有枚举。
  providerCapabilities?: { protocols?: any[]; reasoningEfforts?: any[] }
}

export function ModelGroupsSettingsPanel(props: ModelGroupsSettingsPanelProps) {
  const { controller, loading, modelGroups, providers, providerCapabilities } = props
  const reasoningEffortOptions = providerCapabilities?.reasoningEfforts || []
  const box = modelGroups && typeof modelGroups === 'object' ? modelGroups : {}
  const items = Array.isArray(box.items) ? box.items : []
  // 策略清单只有业务端这一个来源：拿到什么就渲染什么，拿不到就只显示已保存的值。
  const strategies: ModelGroupStrategyOption[] = Array.isArray(box.strategies) ? box.strategies : []
  const strategiesNotice = modelGroupStrategiesNotice(box)
  const busy = loading || !!box.loading || !!box.saving
  const [selectedGroupId, setSelectedGroupId] = React.useState('')

  React.useEffect(() => {
    controller.actions.refreshModelGroups?.(false)
  }, [controller])

  // 列表由当前数组直接派生的 id 驱动：数据就地更新时数组引用不变，
  // 任何以引用为失效依据的记忆化都会让新行停留在旧结果。
  const groupIds = items.map((group: any) => String(group?.id || '')).filter(Boolean)
  const handleGroupMove = (activeId: string, overId: string) => {
    const position = resolveSortMovePosition(groupIds, activeId, overId)
    if (!position) return
    controller.actions.moveModelGroup?.(activeId, overId, position as SortMovePosition)
  }

  const activeGroupId = selectedGroupId && groupIds.includes(selectedGroupId) ? selectedGroupId : groupIds[0] || ''
  const selectedGroup = items.find((group: any) => String(group?.id || '') === activeGroupId) || null

  const createGroup = () => {
    const createdId = controller.actions.createModelGroup?.()
    if (createdId) setSelectedGroupId(String(createdId))
  }

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <SettingsHeading title="模型组" description="把已登记的供应商模型组合成对外模型入口。" />
          <Button startIcon={<RefreshIcon />} variant="text" onClick={() => controller.actions.refreshModelGroups?.(true)} disabled={busy}>{box.loading ? '刷新中…' : '刷新'}</Button>
          <Button startIcon={<AddIcon />} variant="text" onClick={createGroup} disabled={busy}>新建模型组</Button>
          <Button startIcon={<SaveIcon />} variant="contained" onClick={() => controller.actions.saveModelGroups?.()} disabled={busy}>{box.saving ? '保存中…' : '保存'}</Button>
        </Stack>
        {box.error ? <Typography variant="body2" color="error">{String(box.error || '')}</Typography> : null}
        {box.saveError ? <Typography variant="body2" color="error">{String(box.saveError || '')}</Typography> : null}
        {strategiesNotice ? <Typography variant="body2" color="warning.main">{strategiesNotice}</Typography> : null}

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 260, lg: 300 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>模型组列表</Typography>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <Stack spacing={1}>
                  {items.length ? (
                    <SortableList ids={groupIds} onMove={handleGroupMove} disabled={busy}>
                      {({ id: groupId, drag, shouldIgnoreClick }) => {
                        const group = items.find((item: any) => String(item?.id || '') === groupId) || null
                        if (!group) return null
                        const selected = groupId === activeGroupId
                        const modelCount = Array.isArray(group?.models) ? group.models.length : 0
                        return (
                          <Button
                            key={groupId}
                            ref={drag.setNodeRef as any}
                            style={drag.style}
                            {...drag.handleProps}
                            variant={selected ? 'contained' : 'text'}
                            color={selected ? 'primary' : 'inherit'}
                            onClick={() => {
                              if (shouldIgnoreClick()) return
                              setSelectedGroupId(groupId)
                            }}
                            disabled={!groupId}
                            sx={{
                              justifyContent: 'flex-start',
                              minWidth: 0,
                              width: '100%',
                              textTransform: 'none',
                              cursor: drag.isDragging ? 'grabbing' : 'grab',
                              opacity: drag.isDragging ? 0.6 : 1,
                              touchAction: 'pan-y',
                            }}
                          >
                            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(group?.name || '未命名模型组')} · {modelCount} 个对外模型</Box>
                          </Button>
                        )
                      }}
                    </SortableList>
                  ) : <Typography variant="body2" color="text.secondary">暂无模型组。</Typography>}
                </Stack>
              </Box>
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }}>
              {selectedGroup ? (
                <ModelGroupEditor controller={controller} group={selectedGroup} providers={providers} strategies={strategies} reasoningEffortOptions={reasoningEffortOptions} busy={busy} />
              ) : (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">选择一个模型组查看和编辑。</Typography>
                </SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>
      </Stack>
    </SettingsSurface>
  )
}

// 区块标题：把「这个区块是什么 + 有多少条」压成一行，右侧留给该区块自己的动作按钮。
function BlockHeading(props: { title: React.ReactNode; meta?: string }) {
  return (
    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 800, letterSpacing: '.02em' }}>
      {props.title}
      {props.meta ? ` · ${props.meta}` : ''}
    </Typography>
  )
}

// 策略清单拿不到时不留白：把原因和后果一起说清楚，不假装选项还在。
function modelGroupStrategiesNotice(box: any) {
  if (box.loading) return ''
  if (box.strategiesError) return `策略清单加载失败：${String(box.strategiesError)}。下拉只能显示已保存的策略值。`
  if (Array.isArray(box.strategies) && box.strategies.length) return ''
  // 还没取过清单就先别下结论：提示只在第一次刷新给出结果之后出现。
  return Number(box.strategiesFetchedAt || 0) > 0 ? '业务端没有返回可用策略，下拉只能显示已保存的策略值。' : ''
}

function ModelGroupEditor(props: { controller: any; group: any; providers: any[]; strategies: ModelGroupStrategyOption[]; reasoningEffortOptions: CapabilityOption[]; busy: boolean }) {
  const { controller, group, providers, strategies, reasoningEffortOptions, busy } = props
  const groupId = String(group?.id || '')
  const models = Array.isArray(group?.models) ? group.models : []
  return (
    <SettingsSection>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            label="模型组名称"
            value={String(group?.name || '')}
            onChange={(e) => controller.actions.setModelGroupField?.(groupId, 'name', e.target.value)}
            sx={{ flex: 1 }}
          />
          <MoreActionsMenu
            disabled={busy}
            items={[{
              key: 'delete',
              label: '删除组',
              icon: <DeleteOutlineIcon fontSize="small" />,
              danger: true,
              confirm: {
                title: '确认删除模型组？',
                description: `将删除「${String(group?.name || '未命名模型组')}」及其全部对外模型，保存后生效。`,
              },
              onSelect: () => controller.actions.deleteModelGroup?.(groupId),
            }]}
          />
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          <BlockHeading title="对外模型" meta={`${models.length} 个`} />
          <Button size="small" startIcon={<AddIcon />} onClick={() => controller.actions.createModelGroupModel?.(groupId)} disabled={busy}>添加对外模型</Button>
        </Stack>

        {models.length ? models.map((model: any, modelIndex: number) => (
          <ModelGroupModelCard key={`${groupId}:model:${modelIndex}`} controller={controller} groupId={groupId} model={model} modelIndex={modelIndex} providers={providers} strategies={strategies} reasoningEffortOptions={reasoningEffortOptions} busy={busy} />
        )) : (
          <Typography variant="body2" color="text.secondary">这个模型组还没有对外模型。</Typography>
        )}
      </Stack>
    </SettingsSection>
  )
}

function ModelGroupModelCard(props: { controller: any; groupId: string; model: any; modelIndex: number; providers: any[]; strategies: ModelGroupStrategyOption[]; reasoningEffortOptions: CapabilityOption[]; busy: boolean }) {
  const { controller, groupId, model, modelIndex, providers, strategies, reasoningEffortOptions, busy } = props
  const modelId = String(model?.id || '')
  const members = Array.isArray(model?.members) ? model.members : []
  const supportsReasoning = !!model?.supportsReasoning
  // 策略的展示名与可选项全部来自业务端清单；模型上存的值原样参与解析，不做改写。
  const strategy = resolveModelGroupStrategySelection(strategies, model?.strategy)
  const summary = [strategy.label, `${members.length} 个成员`].filter(Boolean).join(' · ')
  return (
    <SettingsSection tone="muted" sx={{ p: 1.5 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900 }} noWrap>{String(modelId || '对外模型')}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{summary}</Typography>
          </Box>
          <MoreActionsMenu
            disabled={busy}
            items={[{
              key: 'delete',
              label: '删除模型',
              icon: <DeleteOutlineIcon fontSize="small" />,
              danger: true,
              confirm: {
                title: '确认删除对外模型？',
                description: `将删除「${String(modelId || '对外模型')}」，保存后生效。`,
              },
              onSelect: () => controller.actions.deleteModelGroupModel?.(groupId, modelIndex),
            }]}
          />
        </Stack>

        <Stack spacing={2} sx={{ '& .MuiFormHelperText-root': { fontSize: 11, opacity: 0.85 } }}>
          <TextField
            size="small"
            label="对外模型 ID"
            value={modelId}
            onChange={(e) => controller.actions.setModelGroupModelField?.(groupId, modelIndex, 'id', e.target.value)}
            helperText="角色与聊天引用这个入口，稳定后再用。"
          />
          {/* 清单为空就没有可选项：与其伪造选项，不如明确禁用，让上方提示解释原因。 */}
          <FormControl size="small" fullWidth disabled={!strategy.options.length}>
            <InputLabel>策略</InputLabel>
            <Select
              label="策略"
              value={strategy.value}
              onChange={(e) => controller.actions.setModelGroupModelField?.(groupId, modelIndex, 'strategy', e.target.value)}
            >
              {strategy.options.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
            {strategy.description ? <FormHelperText>{strategy.description}</FormHelperText> : null}
          </FormControl>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <FormControlLabel sx={{ m: 0 }} control={<Switch checked={supportsReasoning} onChange={(e) => controller.actions.setModelGroupModelField?.(groupId, modelIndex, 'supportsReasoning', e.target.checked)} />} label="可推理" />
            {supportsReasoning ? null : (
              <Typography variant="caption" color="text.secondary">开启后可指定默认思考强度。</Typography>
            )}
          </Stack>
          {supportsReasoning ? (
            <FormControl size="small" fullWidth>
              <InputLabel>默认思考</InputLabel>
              <Select label="默认思考" value={String(model?.defaultReasoningEffort || '')} onChange={(e) => controller.actions.setModelGroupModelField?.(groupId, modelIndex, 'defaultReasoningEffort', e.target.value)}>
                {resolveCapabilitySelection(reasoningEffortOptions, model?.defaultReasoningEffort).options.map((option: any) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
              </Select>
            </FormControl>
          ) : null}
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          <BlockHeading title="成员模型" meta={`${members.length} 个`} />
          <Button size="small" startIcon={<AddIcon />} onClick={() => controller.actions.createModelGroupMember?.(groupId, modelIndex)} disabled={busy}>添加成员</Button>
        </Stack>

        {members.length ? members.map((member: any, index: number) => (
          <ModelGroupMemberRow key={index} controller={controller} groupId={groupId} modelIndex={modelIndex} member={member} memberIndex={index} providers={providers} busy={busy} />
        )) : null}
      </Stack>
    </SettingsSection>
  )
}

function ModelGroupMemberRow(props: { controller: any; groupId: string; modelIndex: number; member: any; memberIndex: number; providers: any[]; busy: boolean }) {
  const { controller, groupId, modelIndex, member, memberIndex, providers, busy } = props
  const providerId = String(member?.providerId || '')
  const provider = providers.find((item: any) => String(item?.id || '') === providerId) || null
  const registeredModels = Array.isArray(provider?.registeredModels) ? provider.registeredModels : []
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
      <FormControl size="small" sx={{ flex: 1 }}>
        <InputLabel>供应商</InputLabel>
        <Select label="供应商" value={providerId} onChange={(e) => controller.actions.setModelGroupMemberField?.(groupId, modelIndex, memberIndex, 'providerId', e.target.value)}>
          <MenuItem value=""><em>请选择供应商</em></MenuItem>
          {providers.map((providerItem: any) => <MenuItem key={String(providerItem?.id || '')} value={String(providerItem?.id || '')}>{String(providerItem?.name || '')}</MenuItem>)}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ flex: 1 }}>
        <InputLabel>登记模型</InputLabel>
        <Select label="登记模型" value={String(member?.modelId || '')} onChange={(e) => controller.actions.setModelGroupMemberField?.(groupId, modelIndex, memberIndex, 'modelId', e.target.value)} disabled={!providerId}>
          <MenuItem value=""><em>请选择模型</em></MenuItem>
          {registeredModels.map((model: any) => <MenuItem key={String(model?.id || '')} value={String(model?.id || '')}>{String(model?.id || '')}</MenuItem>)}
        </Select>
      </FormControl>
      <TextField size="small" label="权重" type="number" value={String(member?.weight || 1)} onChange={(e) => controller.actions.setModelGroupMemberField?.(groupId, modelIndex, memberIndex, 'weight', e.target.value)} inputProps={{ min: 1, step: 1 }} sx={{ width: { xs: '100%', md: 120 } }} />
      <MoreActionsMenu
        disabled={busy}
        items={[{
          key: 'delete',
          label: '删除',
          icon: <DeleteOutlineIcon fontSize="small" />,
          danger: true,
          confirm: {
            title: '确认删除成员？',
            description: '将移除该供应商模型成员，保存后生效。',
          },
          onSelect: () => controller.actions.deleteModelGroupMember?.(groupId, modelIndex, memberIndex),
        }]}
      />
    </Stack>
  )
}
