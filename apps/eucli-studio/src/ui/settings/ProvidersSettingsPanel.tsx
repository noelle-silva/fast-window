import { Box, Button, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SaveIcon from '@mui/icons-material/Save'
import { NEW_PROVIDER_ID } from '../../domain/constants'
import { ProviderConfigEditor } from '../components/ProviderConfigEditor'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { SortableList } from '../components/SortableList'
import { resolveSortMovePosition, type SortMovePosition } from '../components/SortableDnd'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { SettingsHeading, SettingsSection, SettingsSurface } from './SettingsSurfaces'
import { providerProtocolLabel } from './modelItemSelectors'

type ProvidersSettingsPanelProps = {
  controller: any
  loading: boolean
  providers: any[]
  draft: any
  models: any
}

export function ProvidersSettingsPanel(props: ProvidersSettingsPanelProps) {
  const { controller, loading, providers, draft, models } = props
  const editingId = String(draft?.editProviderId || '')
  const selectedProvider = providers.find((provider: any) => String(provider?.id || '') === editingId) || null
  const isNewDraft = editingId === NEW_PROVIDER_ID
  // 新建草稿不是集合里的实体：右侧编辑器由草稿派生一份虚拟供应商，
  // 列表则继续只展示已保存实体，保证不会出现幽灵行。
  const draftProvider = isNewDraft
    ? {
        id: '',
        name: String(draft?.providerName || ''),
        baseUrl: String(draft?.providerBaseUrl || ''),
        protocol: String(draft?.providerProtocol || ''),
        apiKeyStrategy: String(draft?.providerApiKeyStrategy || 'sequential'),
        apiKeys: Array.isArray(draft?.providerApiKeys) ? draft.providerApiKeys : [],
        registeredModels: Array.isArray(draft?.providerRegisteredModels) ? draft.providerRegisteredModels : [],
        modelsCache: { items: [], fetchedAt: 0 },
      }
    : null
  const editorProvider = selectedProvider || draftProvider
  // controller 就地修改 providers 数组（unshift / 改字段），数组引用不会变化；
  // 编号清单必须每次渲染直接从当前数组派生，不能以引用作为记忆化依据。
  const providerIds = providers.map((provider: any) => String(provider?.id || '').trim()).filter(Boolean)
  const handleMove = (activeId: string, overId: string) => {
    const position = resolveSortMovePosition(providerIds, activeId, overId)
    if (!position) return
    controller.actions.moveProvider?.(activeId, overId, position as SortMovePosition)
  }

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <SettingsHeading title="供应商管理" description="维护供应商的连接信息与已登记的模型。" />
          <Button startIcon={<AddIcon />} variant="text" onClick={() => controller.actions.createProvider()} disabled={loading}>新建供应商</Button>
          <Button startIcon={<SaveIcon />} variant="contained" onClick={() => controller.actions.saveProvider()} disabled={loading || !editorProvider}>保存</Button>
          <MoreActionsMenu
            disabled={loading || !selectedProvider}
            items={[{
              key: 'delete',
              label: '删除供应商',
              icon: <DeleteOutlineIcon fontSize="small" />,
              danger: true,
              onSelect: () => controller.actions.askDeleteProvider(editingId),
            }]}
          />
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 260, lg: 300 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>供应商列表</Typography>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <Stack spacing={1}>
                  {providerIds.length ? (
                    <SortableList ids={providerIds} onMove={handleMove} disabled={loading}>
                      {({ id: pid, drag, shouldIgnoreClick }) => {
                        const provider = providers.find((item: any) => String(item?.id || '') === pid) || null
                        if (!provider) return null
                        const selected = pid === editingId
                        return (
                          <Button
                            key={pid}
                            ref={drag.setNodeRef as any}
                            style={drag.style}
                            {...drag.handleProps}
                            variant={selected ? 'contained' : 'text'}
                            color={selected ? 'primary' : 'inherit'}
                            onClick={() => {
                              if (shouldIgnoreClick()) return
                              controller.actions.openProviderEditor?.(pid)
                            }}
                            disabled={!pid}
                            sx={{
                              justifyContent: 'flex-start',
                              minWidth: 0,
                              width: '100%',
                              textTransform: 'none',
                              textAlign: 'left',
                              cursor: drag.isDragging ? 'grabbing' : 'grab',
                              opacity: drag.isDragging ? 0.6 : 1,
                              touchAction: 'pan-y',
                            }}
                          >
                            <Box sx={{ minWidth: 0, width: '100%' }}>
                              <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 800 }}>{String(provider?.name || '')}</Box>
                              <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'text.secondary' }}>
                                {providerProtocolLabel(provider?.protocol)} · {String(provider?.baseUrl || '')}
                              </Box>
                            </Box>
                          </Button>
                        )
                      }}
                    </SortableList>
                  ) : <Typography variant="body2" color="text.secondary">暂无供应商。</Typography>}
                </Stack>
              </Box>
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }}>
              {editorProvider ? (
                <SettingsSection>
                  <ProviderConfigEditor controller={controller} draft={draft} provider={editorProvider} loading={loading} models={models} />
                </SettingsSection>
              ) : (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">选择一个供应商查看和编辑。</Typography>
                </SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>
      </Stack>
    </SettingsSurface>
  )
}
