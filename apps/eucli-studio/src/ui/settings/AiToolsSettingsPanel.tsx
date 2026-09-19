import * as React from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import BuildIcon from '@mui/icons-material/Build'
import CloseIcon from '@mui/icons-material/Close'
import RefreshIcon from '@mui/icons-material/Refresh'
import SettingsIcon from '@mui/icons-material/Settings'
import StorefrontIcon from '@mui/icons-material/Storefront'
import { useEvent } from '../hooks/useEvent'
import { ConfigFieldsForm } from './ConfigFieldsForm'
import { SettingsListItem, SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'
import { ToolPromptDescriptionSection } from './ToolPromptDescriptionSection'
import { ArtifactStoreDialog } from './ArtifactStoreDialog'
import { plainObject, stringField } from './schemaFieldValues'
import { artifactStatusLabels, compatibilityRangeText, isArtifactBusy, type CompatibilityStatus, type EucliBoxCompatibility, type ReleaseArtifactIdentity, type ReleaseCandidatesView } from '../../domain/release'

type AiToolsSettingsPanelProps = {
  controller: any
  loading: boolean
  tools: any
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
  const { controller, loading, tools, releaseView, onReleaseRefresh } = props
  const [filter, setFilter] = React.useState('')
  const [storeOpen, setStoreOpen] = React.useState(false)

  React.useEffect(() => {
    controller.actions.refreshTools?.(false)
    controller.actions.syncToolInstallStates?.()
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

  return (
    <>
      <SettingsSurface>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(25,118,210,.10)', color: 'primary.main', display: 'grid', placeItems: 'center' }}>
                <BuildIcon fontSize="small" />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900 }}>AI 工具</Typography>
                <Typography variant="body2" color="text.secondary">
                  从 e-b 工具目录加载工具，并编辑工具的用户配置。
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button startIcon={<StorefrontIcon />} variant="contained" onClick={() => setStoreOpen(true)}>
                商店
              </Button>
              <Button startIcon={<RefreshIcon />} variant="text" onClick={() => controller.actions.refreshTools?.(true)} disabled={loading || !!tools?.loading}>
                {tools?.loading ? '刷新中…' : '刷新工具'}
              </Button>
            </Stack>
          </Stack>

          <ToolBusyPromptDialog controller={controller} tools={tools} />

          <TextField
            size="small"
            label="搜索工具"
            placeholder="搜索工具名、描述或类型"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            fullWidth
          />

          {tools?.error ? (
            <Typography variant="body2" color="error">
              {String(tools.error || '')}
            </Typography>
          ) : null}

          <Stack spacing={1.25}>
            {filtered.length ? (
              filtered.map((tool) => <ToolCard key={toolId(tool)} controller={controller} tool={tool} loading={loading} installStates={tools?.installStates} />)
            ) : (
              <SettingsSection tone="muted" sx={{ p: 3, textAlign: 'center' }}>
                <Typography sx={{ fontWeight: 900 }}>{tools?.loading ? '工具列表加载中…' : '暂无可显示工具'}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {query ? '当前搜索没有匹配结果。' : '请确认 e-b 已加载工具目录。'}
                </Typography>
              </SettingsSection>
            )}
          </Stack>
        </Stack>
      </SettingsSurface>

      <ToolConfigDialog controller={controller} tools={tools} />

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
    </>
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

function ToolCard(props: { controller: any; tool: ToolSummary; loading: boolean; installStates: any }) {  const { controller, tool, loading, installStates } = props
  const id = toolId(tool)
  const name = toolName(tool)
  const description = toolDescription(tool)
  const unavailable = String(tool.status || '').trim() !== 'active'
  const stateForTool = installStates && typeof installStates === 'object' ? installStates[id] || null : null
  return (
    <SettingsListItem tone={unavailable ? 'danger' : 'default'}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: 'grey.100', display: 'grid', placeItems: 'center', color: 'text.secondary', flexShrink: 0 }}>
            <BuildIcon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 900 }}>{name}</Typography>
              {String(tool.type || '').trim() ? <SettingsPill>{String(tool.type)}</SettingsPill> : null}
              <SettingsPill tone={unavailable ? 'danger' : 'selected'}>{unavailable ? '不可用' : '可用'}</SettingsPill>
              <SettingsPill>v{String(tool.version || '无效')}</SettingsPill>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {description || '暂无描述'}
            </Typography>
            <Typography variant="caption" color="text.secondary">适用本体：{compatibilityRangeText(tool.eucliBoxCompatibility)}</Typography>
            {unavailable && String(tool.statusMessage || '').trim() ? <Typography variant="caption" color="error" sx={{ display: 'block' }}>{String(tool.statusMessage)}</Typography> : null}
            {stateForTool ? <InstallStatusLine state={stateForTool} /> : null}
          </Box>
        </Stack>
        <Button variant="text" onClick={() => controller.actions.openToolConfig?.(id)} disabled={loading || !id} sx={{ alignSelf: { xs: 'flex-end', sm: 'center' } }}>
          查看/配置
        </Button>
      </Stack>
    </SettingsListItem>
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

function ToolConfigDialog(props: { controller: any; tools: any }) {
  const { controller, tools } = props
  const selectedTool = tools?.selectedTool && typeof tools.selectedTool === 'object' ? tools.selectedTool : null
  const open = !!tools?.selectedToolId || !!selectedTool || !!tools?.detailLoading
  const name = toolName(selectedTool || { id: tools?.selectedToolId })
  const unavailable = String(selectedTool?.status || '').trim() !== 'active'
  const save = useEvent(() => controller.actions.saveSelectedToolConfig?.())

  return (
    <Dialog open={open} onClose={() => controller.actions.closeToolConfig?.()} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SettingsIcon fontSize="small" />
        AI 工具配置
        {name ? (
          <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
            {name}
          </Typography>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <IconButton onClick={() => controller.actions.closeToolConfig?.()} size="small" aria-label="关闭工具配置">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: 'grey.50' }}>
        <Stack spacing={1.5}>
          {tools?.detailLoading ? (
            <Typography variant="body2" color="text.secondary">
              工具详情加载中…
            </Typography>
          ) : null}
          {tools?.detailError ? (
            <Typography variant="body2" color="error">
              {String(tools.detailError || '')}
            </Typography>
          ) : null}

          {selectedTool ? (
            <>
              <SettingsSection tone="muted">
                <Stack spacing={0.75}>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 900 }}>{toolName(selectedTool)}</Typography>
                    {String(selectedTool.type || '').trim() ? <SettingsPill>{String(selectedTool.type)}</SettingsPill> : null}
                    <SettingsPill tone={unavailable ? 'danger' : 'selected'}>{unavailable ? '不可用' : '可用'}</SettingsPill>
                    <SettingsPill>v{String(selectedTool.version || '无效')}</SettingsPill>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {toolDescription(selectedTool) || '暂无描述'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">适用本体：{compatibilityRangeText(selectedTool.eucliBoxCompatibility)}</Typography>
                  {unavailable && selectedTool.statusMessage ? <Typography variant="caption" color="error">{String(selectedTool.statusMessage)}</Typography> : null}
                </Stack>
              </SettingsSection>

              <Box component="fieldset" disabled={unavailable} sx={{ p: 0, m: 0, minWidth: 0, border: 0 }}>
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
                </Stack>
              </Box>

              {tools?.saveError ? (
                <Typography variant="body2" color="error">
                  {String(tools.saveError || '')}
                </Typography>
              ) : null}

              <ToolInputSchemaSummary schema={selectedTool?.inputSchema} />
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => controller.actions.closeToolConfig?.()}>取消</Button>
        <Button variant="contained" onClick={save} disabled={!selectedTool || unavailable || !!tools?.saving || !!tools?.detailLoading}>
          {tools?.saving ? '保存中…' : '保存配置'}
        </Button>
      </DialogActions>
    </Dialog>
  )
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
