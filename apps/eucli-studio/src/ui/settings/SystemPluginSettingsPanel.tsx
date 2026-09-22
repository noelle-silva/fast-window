import * as React from 'react'
import { Box, Button, Stack, Switch, TextField, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import StorefrontIcon from '@mui/icons-material/Storefront'
import { hostingLabel, pluginStatusLabel, systemPluginLocatorId, type SystemPluginDetail } from '../../domain/systemPlugin'
import { compatibilityRangeText, artifactStatusLabels, isArtifactBusy, type ReleaseArtifactIdentity, type ReleaseCandidatesView } from '../../domain/release'
import { cloneConfigObject, ConfigFieldsForm, removeConfigValueAtPath, setConfigValueAtPath } from './ConfigFieldsForm'
import { ArtifactStoreDialog } from './ArtifactStoreDialog'
import { SettingsSection, SettingsSurface } from './SettingsSurfaces'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { useEvent } from '../hooks/useEvent'

type SystemPluginSettingsPanelProps = {
  controller: any
  loading: boolean
  systemPlugins: any
  releaseView: ReleaseCandidatesView | null
  onReleaseRefresh: (kind?: string) => Promise<void> | void
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function SystemPluginSettingsPanel(props: SystemPluginSettingsPanelProps) {
  const { controller, loading, systemPlugins, releaseView, onReleaseRefresh } = props
  const busy = loading || !!systemPlugins?.loading || !!systemPlugins?.detailLoading || !!systemPlugins?.saving
  const selectedPlugin = systemPlugins?.selectedPlugin as SystemPluginDetail | null
  const unavailable = selectedPlugin?.status !== 'active'
  const [storeOpen, setStoreOpen] = React.useState(false)
  const [pluginQuery, setPluginQuery] = React.useState('')
  const [nameOverrides, setNameOverrides] = React.useState<Record<string, string>>({})
  const [configDraft, setConfigDraft] = React.useState<Record<string, any>>({})
  const [localError, setLocalError] = React.useState('')

  const handleStoreAction = useEvent(async (artifact: ReleaseArtifactIdentity, action: 'install' | 'update') => {
    const pluginId = String(artifact?.id || '').trim()
    if (!pluginId) return
    if (action === 'install') await controller.actions.installSystemPlugin?.(pluginId)
    else await controller.actions.updateSystemPlugin?.(pluginId)
  })

  const handleStoreCancel = useEvent(async (artifact: ReleaseArtifactIdentity) => {
    const pluginId = String(artifact?.id || '').trim()
    if (!pluginId) return
    await controller.actions.cancelSystemPluginInstall?.(pluginId)
  })

  const handleStoreSync = useEvent(async () => {
    await controller.actions.syncSystemPluginInstallStates?.()
  })

  React.useEffect(() => {
    controller.actions.refreshSystemPlugins?.(false)
    controller.actions.syncSystemPluginInstallStates?.()
  }, [controller])

  // 安装任务终态时静默对齐商店清单；监听器仅在面板打开期间注册。
  React.useEffect(() => {
    controller.actions.setSystemPluginInstallTerminalListener?.(() => {
      void Promise.resolve(onReleaseRefresh?.('plugin')).catch(() => {})
    })
    return () => controller.actions.setSystemPluginInstallTerminalListener?.(null)
  }, [controller, onReleaseRefresh])

  React.useEffect(() => {
    const plugin = selectedPlugin || null
    const overrides: Record<string, string> = {}
    for (const item of plugin?.placeholderInterfaces || []) {
      if (text(item.effectiveName) && text(item.effectiveName) !== text(item.defaultName)) overrides[item.id] = item.effectiveName
    }
    setNameOverrides(overrides)
    setConfigDraft(cloneConfigObject(plugin?.userConfig))
    setLocalError('')
  }, [selectedPlugin])

  const save = async () => {
    if (!selectedPlugin?.id) return
    setLocalError('')
    await controller.actions.saveSystemPluginConfig?.(selectedPlugin.id, { userConfig: configDraft, placeholderNameOverrides: nameOverrides })
  }

  const pluginItems = Array.isArray(systemPlugins?.items) ? systemPlugins.items : []
  const pluginQueryText = pluginQuery.trim().toLowerCase()
  const visiblePlugins = pluginQueryText
    ? pluginItems.filter((plugin: any) => systemPluginLocatorId(plugin).toLowerCase().includes(pluginQueryText))
    : pluginItems

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900 }}>系统插件管理</Typography>
            <Typography variant="caption" color="text.secondary">管理本地系统插件、占位符接口名字和插件用户配置。</Typography>
          </Box>
          <Button startIcon={<StorefrontIcon />} variant="contained" onClick={() => setStoreOpen(true)}>商店</Button>
          <Button startIcon={<RefreshIcon />} variant="text" onClick={() => controller.actions.refreshSystemPlugins?.(true)} disabled={busy}>{systemPlugins?.loading ? '刷新中…' : '刷新'}</Button>
          <Button startIcon={<SaveIcon />} variant="contained" onClick={save} disabled={busy || unavailable || !selectedPlugin?.id}>{systemPlugins?.saving ? '保存中…' : '保存设置'}</Button>
        </Stack>
        {systemPlugins?.error ? <Typography variant="body2" color="error">{String(systemPlugins.error || '')}</Typography> : null}
        {systemPlugins?.detailError ? <Typography variant="body2" color="error">{String(systemPlugins.detailError || '')}</Typography> : null}
        {systemPlugins?.saveError ? <Typography variant="body2" color="error">{String(systemPlugins.saveError || '')}</Typography> : null}
        {localError ? <Typography variant="body2" color="error">{localError}</Typography> : null}

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 260, lg: 300 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <TextField
                size="small"
                label="搜索插件 id"
                value={pluginQuery}
                onChange={(event) => setPluginQuery(event.target.value)}
                fullWidth
              />
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <Stack spacing={1}>
                  {visiblePlugins.length ? visiblePlugins.map((plugin: any) => {
                    const locatorId = systemPluginLocatorId(plugin)
                    const selected = locatorId === text(systemPlugins?.selectedPluginId)
                    const pluginUnavailable = text(plugin.status) !== 'active'
                    const toggling = text(systemPlugins?.togglingId) === locatorId
                    return (
                      <Stack key={locatorId} direction="row" spacing={0.5} alignItems="center">
                        <Button variant={selected ? 'contained' : 'text'} color={pluginUnavailable ? 'error' : selected ? 'primary' : 'inherit'} onClick={() => controller.actions.openSystemPlugin?.(locatorId)} sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textTransform: 'none' }}>
                          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(plugin.name || locatorId)} · v{String(plugin.version || '无效')} · {pluginStatusLabel(plugin.status)}</Box>
                        </Button>
                        <Switch
                          size="small"
                          checked={plugin.enabled !== false}
                          disabled={toggling || !locatorId}
                          onChange={(event) => controller.actions.setSystemPluginEnabled?.(locatorId, event.target.checked)}
                          inputProps={{ 'aria-label': `${String(plugin.name || locatorId)} 启用开关` }}
                        />
                      </Stack>
                    )
                  }) : <Typography variant="body2" color="text.secondary">{pluginQueryText ? '没有匹配的插件。' : '暂无已加载插件。'}</Typography>}
                </Stack>
              </Box>
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }}>
              {selectedPlugin ? (
                <Stack spacing={1.25}>
                  <SettingsSection>
                    <Stack spacing={0.5}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography sx={{ fontWeight: 900 }}>{selectedPlugin.name || selectedPlugin.id}</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Switch
                            size="small"
                            checked={selectedPlugin.enabled !== false}
                            disabled={busy || text(systemPlugins?.togglingId) === systemPluginLocatorId(selectedPlugin)}
                            onChange={(event) => controller.actions.setSystemPluginEnabled?.(systemPluginLocatorId(selectedPlugin), event.target.checked)}
                            inputProps={{ 'aria-label': `${String(selectedPlugin.name || selectedPlugin.id)} 启用开关` }}
                          />
                          <Typography variant="body2" color="text.secondary">启用</Typography>
                        </Stack>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">{selectedPlugin.description}</Typography>
                      <Typography variant="caption" color="text.secondary">版本：{selectedPlugin.version || '无效'}；适用本体：{compatibilityRangeText(selectedPlugin.eucliBoxCompatibility)}</Typography>
                      <Typography variant="caption" color="text.secondary">类型：{hostingLabel(selectedPlugin.hosting)}；状态：{pluginStatusLabel(selectedPlugin.status)}</Typography>
                      {selectedPlugin.statusMessage ? <Typography variant="caption" color="error">{selectedPlugin.statusMessage}</Typography> : null}
                      <PluginInstallStatusLine state={systemPlugins?.installStates?.[text(selectedPlugin.id)]} pluginId={text(selectedPlugin.id)} />
                    </Stack>
                  </SettingsSection>

                  <SettingsSection>
                    <Stack spacing={1}>
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>占位符接口</Typography>
                      {selectedPlugin.placeholderInterfaces.length ? selectedPlugin.placeholderInterfaces.map((item) => (
                        <Stack key={item.id} spacing={0.5}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>{item.description || item.id}</Typography>
                          <TextField size="small" label={`占位符名（默认：${item.defaultName}）`} value={nameOverrides[item.id] ?? item.effectiveName ?? item.defaultName} onChange={(e) => setNameOverrides((current) => ({ ...current, [item.id]: e.target.value }))} disabled={busy || unavailable} fullWidth />
                        </Stack>
                      )) : <Typography variant="body2" color="text.secondary">这个插件没有声明占位符接口。</Typography>}
                    </Stack>
                  </SettingsSection>

                  <SettingsSection>
                    <Stack spacing={1}>
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>用户配置</Typography>
                      <Box component="fieldset" disabled={unavailable} sx={{ p: 0, m: 0, minWidth: 0, border: 0 }}>
                        <ConfigFieldsForm
                          schema={selectedPlugin.configSchema}
                          defaultConfig={selectedPlugin.defaultConfig}
                          userConfig={selectedPlugin.userConfig}
                          draftConfig={configDraft}
                          emptyText="这个插件当前没有可编辑的用户配置字段。"
                          onSetValue={(path, value) => setConfigDraft((current) => setConfigValueAtPath(current, path, value))}
                          onRemoveValue={(path) => setConfigDraft((current) => removeConfigValueAtPath(current, path))}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">配置保存后会在下一次提示词解析时生效。</Typography>
                    </Stack>
                  </SettingsSection>
                </Stack>
              ) : (
                <SettingsSection sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">选择一个系统插件查看详情。</Typography></SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>
      </Stack>
      <ArtifactStoreDialog
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        kind="plugin"
        title="系统插件商店"
        releaseView={releaseView}
        installStates={systemPlugins?.installStates || {}}
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

function PluginInstallStatusLine(props: { state: any; pluginId: string }) {
  const state = props.state && typeof props.state === 'object' ? props.state : {}
  if (!props.pluginId || String(state.artifact?.id || '') !== props.pluginId) return null
  const status = String(state.status || '')
  const error = state.error && typeof state.error === 'object' ? state.error : {}
  const code = String(error.code || '')
  const message = String(error.message || '')
  const phase = String(error.phase || '')
  if (isArtifactBusy(state)) {
    const label = artifactStatusLabels[status] || status
    const total = Number(state.progress?.totalBytes || 0)
    const received = Number(state.progress?.receivedBytes || 0)
    const percent = status === 'downloading' && total > 0 ? ` ${Math.max(0, Math.min(100, Math.round((received / total) * 100)))}%` : ''
    return <Typography variant="caption" color="info.main">正在处理安装/更新：{label}{percent}</Typography>
  }
  if (status === 'cancelled') {
    return <Typography variant="caption" color="text.secondary">上次操作已取消</Typography>
  }
  if (status === 'blocked' && code) {
    return <Typography variant="caption" color="warning.main">操作被阻止（{code}）：{message || '请稍后重试'}</Typography>
  }
  if (code) {
    return <Typography variant="caption" color="error">上次操作失败（{code}@{phase || '未知阶段'}）：{message || '未知原因'}</Typography>
  }
  return null
}
