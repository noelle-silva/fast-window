import * as React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import BuildIcon from '@mui/icons-material/Build'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import StorefrontIcon from '@mui/icons-material/Storefront'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { useEvent } from '../hooks/useEvent'
import { ConfigFieldsForm } from './ConfigFieldsForm'
import { SettingsHeading, SettingsListItem, SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'
import { ToolCapabilityGrantsSection } from './ToolCapabilityGrantsSection'
import { ToolPromptDescriptionSection } from './ToolPromptDescriptionSection'
import { ToolWorkDirectorySection } from './ToolWorkDirectorySection'
import { ArtifactStoreDialog } from './ArtifactStoreDialog'
import { plainObject, stringField } from './schemaFieldValues'
import { artifactStatusLabels, compatibilityRangeText, isArtifactBusy, type CompatibilityStatus, type EucliBoxCompatibility, type ReleaseArtifactIdentity, type ReleaseCandidatesView } from '../../domain/release'

type AiToolsSettingsPanelProps = {
  controller: any
  loading: boolean
  tools: any
  toolWorkDirectory?: any
  releaseView: ReleaseCandidatesView | null
  onReleaseRefresh: (kind?: string) => Promise<void> | void
}

type ToolSummary = {
  id?: unknown
  name?: unknown
  description?: unknown
  version?: unknown
  eucliBoxCompatibility?: EucliBoxCompatibility
  compatibility?: CompatibilityStatus
  status?: unknown
  statusMessage?: unknown
  type?: unknown
  updatedAt?: unknown
}

export function AiToolsSettingsPanel(props: AiToolsSettingsPanelProps) {
  const { controller, loading, tools, toolWorkDirectory, releaseView, onReleaseRefresh } = props
  const [filter, setFilter] = React.useState('')
  const [storeOpen, setStoreOpen] = React.useState(false)

  React.useEffect(() => {
    controller.actions.refreshTools?.(false)
    controller.actions.syncToolInstallStates?.()
    controller.actions.refreshToolWorkDirectory?.()
  }, [controller])

  // 安装任务终态时静默对齐商店清单；监听器仅在面板打开期间注册。
  React.useEffect(() => {
    controller.actions.setToolInstallTerminalListener?.(() => {
      void Promise.resolve(onReleaseRefresh?.('tool')).catch(() => {})
    })
    return () => controller.actions.setToolInstallTerminalListener?.(null)
  }, [controller, onReleaseRefresh])

  const handleStoreAction = useEvent(async (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => {
    const toolId = String(artifact?.id || '').trim()
    if (!toolId) return
    if (action === 'install') await controller.actions.installTool?.(toolId)
    else await controller.actions.updateTool?.(toolId)
  })

  const handleStoreCancel = useEvent(async (artifact: ReleaseArtifactIdentity) => {
    const toolId = String(artifact?.id || '').trim()
    if (!toolId) return
    await controller.actions.cancelToolInstall?.(toolId)
  })

  const handleStoreSync = useEvent(async () => {
    await controller.actions.syncToolInstallStates?.()
  })

  const items = toolItems(tools)
  const query = filter.trim().toLowerCase()
  const filtered = query
    ? items.filter((tool) => [toolName(tool), toolDescription(tool), String(tool.type || '')].some((value) => value.toLowerCase().includes(query)))
    : items

  const selectedTool = tools?.selectedTool && typeof tools.selectedTool === 'object' ? tools.selectedTool : null
  const selectedToolUnavailable = String(selectedTool?.status || '').trim() !== 'active'
  const selectedToolId = toolId(selectedTool || { id: tools?.selectedToolId })
  const selectedInstallState = tools?.installStates && selectedToolId ? tools.installStates[selectedToolId] || null : null
  const save = useEvent(() => controller.actions.saveSelectedToolConfig?.())

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(25,118,210,.10)', color: 'primary.main', display: 'grid', placeItems: 'center' }}>
              <BuildIcon fontSize="small" />
            </Box>
            <SettingsHeading title="AI 工具管理" description="从 e-b 工具目录加载工具，并编辑工具的用户配置。" descriptionVariant="body2" />
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button startIcon={<FolderOutlinedIcon />} variant="outlined" onClick={() => controller.actions.showToolWorkDirectoryView?.()}>
              默认工作目录
            </Button>
            <Button startIcon={<StorefrontIcon />} variant="contained" onClick={() => setStoreOpen(true)}>
              商店
            </Button>
            <Button startIcon={<RefreshIcon />} variant="text" onClick={() => controller.actions.refreshTools?.(true)} disabled={loading || !!tools?.loading}>
              {tools?.loading ? '刷新中…' : '刷新工具'}
            </Button>
            <Button startIcon={<SaveIcon />} variant="contained" onClick={save} disabled={!selectedTool || selectedToolUnavailable || !!tools?.saving || !!tools?.detailLoading}>
              {tools?.saving ? '保存中…' : '保存配置'}
            </Button>
          </Stack>
        </Stack>

        <ToolBusyPromptDialog controller={controller} tools={tools} />

        {tools?.error ? (
          <Typography variant="body2" color="error">
            {String(tools.error || '')}
          </Typography>
        ) : null}

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 260, lg: 300 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <TextField
                size="small"
                label="搜索工具"
                placeholder="搜索工具名、描述或类型"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                fullWidth
              />
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <Stack spacing={1}>
                  {filtered.length ? filtered.map((tool) => {
                    const id = toolId(tool)
                    const selected = !!id && id === String(tools?.selectedToolId || '')
                    const unavailable = String(tool.status || '').trim() !== 'active'
                    return (
                      <Button
                        key={id}
                        variant={selected ? 'contained' : 'text'}
                        color={unavailable ? 'error' : selected ? 'primary' : 'inherit'}
                        onClick={() => controller.actions.openToolConfig?.(id)}
                        disabled={!id}
                        sx={{ justifyContent: 'flex-start', minWidth: 0, width: '100%', textTransform: 'none' }}
                      >
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toolName(tool)} · v{String(tool.version || '无效')} · {unavailable ? '不可用' : '可用'}</Box>
                      </Button>
                    )
                  }) : (
                    <Typography variant="body2" color="text.secondary">
                      {tools?.loading ? '工具列表加载中…' : query ? '当前搜索没有匹配结果。' : '暂无可显示工具'}
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }}>
              {tools?.workDirectoryView ? (
                <ToolWorkDirectorySection controller={controller} state={toolWorkDirectory} />
              ) : selectedTool ? (
                <Stack spacing={1.25}>
                  {tools?.detailLoading ? <Typography variant="body2" color="text.secondary">工具详情加载中…</Typography> : null}
                  {tools?.detailError ? <Typography variant="body2" color="error">{String(tools.detailError || '')}</Typography> : null}

                  <SettingsSection tone="muted">
                    <Stack spacing={0.75}>
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                        <Typography sx={{ fontWeight: 900 }}>{toolName(selectedTool)}</Typography>
                        {String(selectedTool.type || '').trim() ? <SettingsPill>{String(selectedTool.type)}</SettingsPill> : null}
                        <SettingsPill tone={selectedToolUnavailable ? 'danger' : 'selected'}>{selectedToolUnavailable ? '不可用' : '可用'}</SettingsPill>
                        <SettingsPill>v{String(selectedTool.version || '无效')}</SettingsPill>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {toolDescription(selectedTool) || '暂无描述'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">适用本体：{compatibilityRangeText(selectedTool.eucliBoxCompatibility)}</Typography>
                      {selectedToolUnavailable && selectedTool.statusMessage ? <Typography variant="caption" color="error">{String(selectedTool.statusMessage)}</Typography> : null}
                      {selectedInstallState ? <InstallStatusLine state={selectedInstallState} /> : null}
                    </Stack>
                  </SettingsSection>

                  <Box component="fieldset" disabled={selectedToolUnavailable} sx={{ p: 0, m: 0, minWidth: 0, border: 0 }}>
                    <Stack spacing={1.5}>
                      <ToolPromptDescriptionSection controller={controller} tool={selectedTool} tools={tools} />

                      <SettingsSection>
                        <Stack spacing={1.25}>
                          <Typography sx={{ fontWeight: 900 }}>用户配置</Typography>
                          <ConfigFieldsForm
                            schema={selectedTool?.userConfigSchema}
                            defaultConfig={selectedTool?.defaultConfig}
                            userConfig={selectedTool?.userConfig}
                            draftConfig={tools?.configDraft}
                            emptyText="该工具当前没有可编辑的用户配置字段。"
                            onSetValue={(path, value) => controller.actions.setToolConfigValue?.(path, value)}
                            onRemoveValue={(path) => controller.actions.removeToolConfigValue?.(path)}
                          />
                        </Stack>
                      </SettingsSection>

                      <ToolCapabilityGrantsSection controller={controller} tool={selectedTool} tools={tools} />
                    </Stack>
                  </Box>

                  {tools?.saveError ? (
                    <Typography variant="body2" color="error">
                      {String(tools.saveError || '')}
                    </Typography>
                  ) : null}

                  <ToolInputSchemaSummary schema={selectedTool?.inputSchema} />
                </Stack>
              ) : tools?.detailLoading || tools?.selectedToolId ? (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">工具详情加载中…</Typography>
                </SettingsSection>
              ) : (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">选择一个工具查看配置。</Typography>
                </SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>
      </Stack>

      <ArtifactStoreDialog
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        kind="tool"
        title="AI 工具商店"
        releaseView={releaseView}
        installStates={tools?.installStates || {}}
        onAction={handleStoreAction}
        onCancel={handleStoreCancel}
        onSync={handleStoreSync}
        onRefresh={(kind) => onReleaseRefresh?.(kind)}
        getInstallSource={() => controller.actions.getInstallSource?.()}
        setInstallSource={(kind) => controller.actions.setInstallSource?.(kind)}
      />
    </SettingsSurface>
  )
}

// ToolBusyPromptDialog 展示工具占用交互：用户选择停止该工具的执行，
// 或取消当前更新请求。业务端只提供占用事实与停止动作。
function ToolBusyPromptDialog(props: { controller: any; tools: any }) {
  const { controller, tools } = props
  const prompt = tools?.busyPrompt && typeof tools.busyPrompt === 'object' ? tools.busyPrompt : null
  const stopping = tools?.stopping === true
  const toolNameText = prompt?.toolId ? String(prompt.toolId || '') : ''
  const actionText = prompt?.action === 'install' ? '安装' : '更新'
  return (
    <Dialog open={!!prompt} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <BuildIcon fontSize="small" />
        工具正在使用中
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          无法{actionText}「{toolNameText}」：该工具当前仍有正在执行的调用。你可以停止当前执行后继续，或取消本次请求。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={() => controller.actions.dismissBusyPrompt?.()} disabled={stopping}>
          取消
        </Button>
        <Button variant="contained" color="error" onClick={() => controller.actions.confirmStopAndContinue?.()} disabled={stopping}>
          {stopping ? '停止中…' : '停止该工具并继续'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function InstallStatusLine(props: { state: any }) {
  const state = props.state && typeof props.state === 'object' ? props.state : {}
  const status = String(state.status || '')
  const error = state.error && typeof state.error === 'object' ? state.error : {}
  const code = String(error.code || '')
  const message = String(error.message || '')
  const phase = String(error.phase || '')
  const busy = isArtifactBusy(state)
  if (busy) {
    const label = artifactStatusLabels[status] || status
    const total = Number(state.progress?.totalBytes || 0)
    const received = Number(state.progress?.receivedBytes || 0)
    const percent = status === 'downloading' && total > 0 ? ` ${Math.max(0, Math.min(100, Math.round((received / total) * 100)))}%` : ''
    return <Typography variant="caption" color="info.main" sx={{ display: 'block' }}>正在处理安装/更新：{label}{percent}</Typography>
  }
  if (status === 'cancelled') {
    return <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>上次操作已取消</Typography>
  }
  if (status === 'blocked' && code) {
    return <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>操作被阻止（{code}）：{message || '请稍后重试'}</Typography>
  }
  if (status === 'failed' && code) {
    return <Typography variant="caption" color="error" sx={{ display: 'block' }}>上次操作失败（{code}@{phase || '未知阶段'}）：{message || '未知原因'}</Typography>
  }
  if (code) {
    return <Typography variant="caption" color="error" sx={{ display: 'block' }}>上次操作失败（{code}@{phase || '未知阶段'}）：{message || '未知原因'}</Typography>
  }
  return null
}

function ToolInputSchemaSummary(props: { schema: any }) {
  const properties = plainObject(plainObject(props.schema).properties)
  const fields = Object.keys(properties).map((key) => ({ key, schema: plainObject(properties[key]) }))
  if (!fields.length) return null
  return (
    <SettingsSection tone="muted">
      <Stack spacing={1}>
        <Typography sx={{ fontWeight: 900 }}>工具调用参数</Typography>
        <Stack spacing={0.75}>
          {fields.map((field) => {
            const type = String(field.schema.type || 'string')
            const description = stringField(field.schema.description)
            return (
              <SettingsListItem key={field.key} sx={{ p: 1, bgcolor: 'background.paper' }}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 900 }}>{field.key}</Typography>
                  <SettingsPill>{type}</SettingsPill>
                </Stack>
                {description ? <Typography variant="caption" color="text.secondary">{description}</Typography> : null}
              </SettingsListItem>
            )
          })}
        </Stack>
      </Stack>
    </SettingsSection>
  )
}

function toolItems(tools: any): ToolSummary[] {
  return Array.isArray(tools?.items) ? tools.items.filter((tool: any) => tool && typeof tool === 'object') : []
}

function toolId(tool: any): string {
  return String(tool?.id || tool?.name || '').trim()
}

function toolName(tool: any): string {
  return String(tool?.name || tool?.id || '').trim()
}

function toolDescription(tool: any): string {
  return String(tool?.description || '').trim()
}
