import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Avatar, Box, Button, Chip, CircularProgress, Switch, Typography } from '@mui/material'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import type { AppCapabilityDescriptor, RegisteredApp, RegisteredAppCapabilitySelection } from '../apps/types'
import { isDataImageUrl } from '../utils'
import { appCapabilityConfigFieldsState, listAppCapabilities } from '../apps/appCapabilities'
import { capabilityDescriptorToSelection } from '../apps/appCapabilitySelections'
import HostPageHeader from './HostPageHeader'
import { hostPageRootSx, hostPageScrollSx, hostSurfaceSx } from './hostUiStyles'
import { useHostAppearance } from './hostAppearance'
import CapabilityConfigPanel from './capabilityRegistry/CapabilityConfigPanel'

type CapabilityRegistryPageProps = {
  apps: RegisteredApp[]
  selections: RegisteredAppCapabilitySelection[]
  onBack: () => void
  onSelect: (selection: RegisteredAppCapabilitySelection) => void | Promise<void>
  onUpdateSelection: (appId: string, capabilityId: string, patch: Partial<Omit<RegisteredAppCapabilitySelection, 'appId' | 'capabilityId'>>) => void | Promise<void>
  onRemove: (appId: string, capabilityId: string) => void | Promise<void>
}

type CapabilityEntry = {
  capability: AppCapabilityDescriptor
  registered: boolean
  live: boolean
}

type CapabilitySnapshot = {
  capabilities: Record<string, AppCapabilityDescriptor[]>
  errors: Record<string, CapabilityReadError>
}

type CapabilityReadError = {
  message: string
  canLaunch: boolean
}

function mergeCommandMetadata(selected: RegisteredAppCapabilitySelection, available: AppCapabilityDescriptor | undefined): AppCapabilityDescriptor {
  const selectedCapability = { ...selected, id: selected.capabilityId }
  if (!available) return selectedCapability
  return {
    ...available,
    ...selectedCapability,
    description: selectedCapability.description ?? available.description,
    configFields: selectedCapability.configFields ?? available.configFields,
  }
}

function mergedCapabilities(app: RegisteredApp, selectedCapabilities: RegisteredAppCapabilitySelection[], liveCapabilities: AppCapabilityDescriptor[]): CapabilityEntry[] {
  const selected = selectedCapabilities.filter(capability => capability.appId === app.id)
  const available = Array.isArray(liveCapabilities) ? liveCapabilities : []
  const availableById = new Map(available.map(capability => [capability.id, capability]))
  const seen = new Set<string>()
  const entries: CapabilityEntry[] = []

  for (const capability of selected) {
    const id = String(capability.capabilityId || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const liveCapability = availableById.get(id)
    entries.push({
      capability: mergeCommandMetadata(capability, liveCapability),
      registered: true,
      live: Boolean(liveCapability),
    })
  }

  for (const capability of available) {
    const id = String(capability.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    entries.push({ capability, registered: false, live: true })
  }

  return entries
}

const EMPTY_SNAPSHOT: CapabilitySnapshot = { capabilities: {}, errors: {} }

function capabilityDescription(capability: AppCapabilityDescriptor): string {
  const value = (capability as { description?: unknown }).description
  return typeof value === 'string' ? value.trim() : ''
}

function iconSource(value: string | undefined): string | undefined {
  return value && isDataImageUrl(value) ? value : undefined
}

function iconText(value: string | undefined, fallback: string) {
  const raw = String(value || fallback || '').trim()
  return raw ? raw[0] : '?'
}

export default function CapabilityRegistryPage({ apps, selections, onBack, onSelect, onUpdateSelection, onRemove }: CapabilityRegistryPageProps) {
  const hostAppearance = useHostAppearance()
  const panelSx = hostSurfaceSx(hostAppearance.surfaceMode)
  const itemSx = hostSurfaceSx(hostAppearance.surfaceMode, { tone: 'item' })
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot>(EMPTY_SNAPSHOT)
  const [loadingCapabilities, setLoadingCapabilities] = useState(false)
  const [activeReadAppId, setActiveReadAppId] = useState<string | null>(null)
  const [capabilityReadError, setCapabilityReadError] = useState('')

  const refreshCapabilities = useCallback(async () => {
    if (!apps.length) {
      setSnapshot(EMPTY_SNAPSHOT)
      setCapabilityReadError('')
      return
    }
    setLoadingCapabilities(true)
    setCapabilityReadError('')
    try {
      const result = await listAppCapabilities(apps)
      const capabilities: Record<string, AppCapabilityDescriptor[]> = {}
      const errors: Record<string, CapabilityReadError> = {}
      for (const item of result.apps || []) capabilities[item.appId] = Array.isArray(item.capabilities) ? item.capabilities : []
      for (const item of result.errors || []) {
        if (item.appId) errors[item.appId] = {
          message: item.message || '无法读取应用当前能力',
          canLaunch: item.canLaunch !== false,
        }
      }
      setSnapshot({ capabilities, errors })
    } catch (error) {
      setSnapshot(EMPTY_SNAPSHOT)
      setCapabilityReadError(String((error as { message?: string })?.message || error || '读取能力清单失败'))
    } finally {
      setLoadingCapabilities(false)
    }
  }, [apps])

  const launchAndRefreshAppCapabilities = useCallback(async (app: RegisteredApp) => {
    setActiveReadAppId(app.id)
    setCapabilityReadError('')
    try {
      const result = await listAppCapabilities([app], { launchPolicy: 'allowLaunch' })
      const hit = result.apps.find(item => item.appId === app.id)
      const error = result.errors.find(item => item.appId === app.id)
      setSnapshot(prev => {
        const capabilities = { ...prev.capabilities, [app.id]: Array.isArray(hit?.capabilities) ? hit.capabilities : [] }
        const errors = { ...prev.errors }
        if (error) {
          errors[app.id] = {
            message: error.message || '无法读取应用当前能力',
            canLaunch: error.canLaunch !== false,
          }
        } else {
          delete errors[app.id]
        }
        return { capabilities, errors }
      })
    } catch (error) {
      setCapabilityReadError(String((error as { message?: string })?.message || error || '读取能力清单失败'))
    } finally {
      setActiveReadAppId(null)
    }
  }, [])

  useEffect(() => {
    void refreshCapabilities()
  }, [refreshCapabilities])

  const appsWithCapabilities = useMemo(() => apps
    .map(app => ({
      app,
      capabilities: mergedCapabilities(app, selections, snapshot.capabilities[app.id] ?? []),
      error: snapshot.errors[app.id]?.message || '',
      canLaunch: snapshot.errors[app.id]?.canLaunch ?? false,
    }))
    .filter(item => item.capabilities.length > 0 || item.error), [apps, selections, snapshot])
  const capabilityCount = appsWithCapabilities.reduce((sum, item) => sum + item.capabilities.length, 0)
  const selectedCount = appsWithCapabilities.reduce(
    (sum, item) => sum + item.capabilities.filter(capability => capability.registered).length,
    0,
  )

  return (
    <Box sx={hostPageRootSx}>
      <HostPageHeader title="能力登记簿" onBack={onBack} translucent={hostAppearance.glassEnabled} />
      <Box sx={hostPageScrollSx}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={panelSx}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <HubRoundedIcon fontSize="small" color="primary" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                  能力公告栏
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {loadingCapabilities
                    ? '正在读取已运行 App 的当前能力'
                    : capabilityCount > 0
                    ? `已发现 ${capabilityCount} 个能力，已选取 ${selectedCount} 个`
                    : '等待已运行 App 回答能力'}
                </Typography>
              </Box>
              {loadingCapabilities ? <CircularProgress size={18} /> : null}
              <Button size="small" variant="text" disabled={loadingCapabilities || !apps.length} onClick={() => void refreshCapabilities()}>
              重新读取
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.7 }}>
              这里默认只读取已运行 App 当前能提供的能力。打开开关后，该能力会加入主页搜索列表；关闭开关后，会从主页移除。
            </Typography>
            {capabilityReadError ? <Alert severity="error" sx={{ mt: 1.25, borderRadius: 2 }}>{capabilityReadError}</Alert> : null}
          </Box>

          {apps.length === 0 ? (
            <Box sx={panelSx}>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                暂无注册 App。先到设置里注册 App，再回到这里查看它们开放的能力。
              </Typography>
            </Box>
          ) : null}

          {apps.length > 0 && appsWithCapabilities.length === 0 ? (
            <Box sx={panelSx}>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                已注册的 App 暂未返回能力。请先启动目标 App，或在对应卡片里选择启动并读取。
              </Typography>
            </Box>
          ) : null}

          {appsWithCapabilities.map(({ app, capabilities, error, canLaunch }) => {
            const appIcon = iconSource(app.icon)
            const selectedInApp = capabilities.filter(capability => capability.registered).length

            return (
              <Box key={app.id} sx={panelSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
                  <Avatar
                    variant="rounded"
                    src={appIcon}
                    sx={{ width: 34, height: 34, fontSize: 14, bgcolor: 'action.hover', color: 'text.primary', flexShrink: 0 }}
                  >
                    {appIcon ? null : iconText(app.icon, app.name)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {app.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {selectedInApp}/{capabilities.length} 已选取
                    </Typography>
                  </Box>
                </Box>

                {error ? (
                  <Alert
                    severity="warning"
                    sx={{ mb: capabilities.length ? 1.25 : 0, borderRadius: 2 }}
                    action={canLaunch ? (
                      <Button
                        size="small"
                        disabled={activeReadAppId === app.id}
                        onClick={() => void launchAndRefreshAppCapabilities(app)}
                      >
                        {activeReadAppId === app.id ? '读取中…' : '启动并读取'}
                      </Button>
                    ) : undefined}
                  >
                    {error}
                  </Alert>
                ) : null}

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {capabilities.map(({ capability, registered, live }) => {
                    const capabilityIcon = iconSource(capability.icon)
                    const description = capabilityDescription(capability)
                    const { fields: configFields, error: configFieldsError } = appCapabilityConfigFieldsState(capability)
                    const toggleCapability = () => {
                      if (!live && registered) {
                        void onRemove(app.id, capability.id)
                        return
                      }
                      if (!live) return
                      if (!registered && (configFields.length > 0 || configFieldsError)) return
                      if (registered) void onRemove(app.id, capability.id)
                      else void onSelect(capabilityDescriptorToSelection(app.id, capability))
                    }
                    const saveCapabilityConfig = async (config: Record<string, unknown>) => {
                      const nextSelection = { ...capabilityDescriptorToSelection(app.id, capability), config }
                      if (registered) await onUpdateSelection(app.id, capability.id, nextSelection)
                      else await onSelect(nextSelection)
                    }

                    return (
                      <Box
                        key={capability.id}
                        sx={[
                          itemSx,
                          {
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                          },
                        ]}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                          }}
                        >
                          <Avatar
                            variant="rounded"
                            src={capabilityIcon}
                            sx={{ width: 30, height: 30, fontSize: 13, bgcolor: 'action.hover', color: 'text.primary', flexShrink: 0 }}
                          >
                            {capabilityIcon ? null : iconText(capability.icon, capability.title)}
                          </Avatar>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                              <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                                {capability.title}
                              </Typography>
                              <Chip
                                label={registered ? (live ? '已选取' : '已选取但当前不可读') : '可选取'}
                                size="small"
                                color={registered ? (live ? 'primary' : 'warning') : 'default'}
                                variant={registered ? 'filled' : 'outlined'}
                                sx={{ height: 18, fontSize: 10, borderRadius: 1 }}
                              />
                            {configFieldsError ? (
                              <Chip
                                label="配置声明不合法"
                                size="small"
                                color="error"
                                variant="outlined"
                                sx={{ height: 18, fontSize: 10, borderRadius: 1 }}
                              />
                            ) : null}
                            </Box>
                          {description ? (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.45 }}>
                              {description}
                            </Typography>
                          ) : null}
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mt: 0.25, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11 }}
                          >
                            {capability.id}
                          </Typography>
                          </Box>
                          <Switch
                            size="small"
                            checked={registered}
                            disabled={!registered && (!live || configFields.length > 0 || Boolean(configFieldsError))}
                            onChange={toggleCapability}
                            inputProps={{ 'aria-label': `${registered ? '取消选取' : '选取'} ${capability.title}` }}
                          />
                        </Box>
                        {live ? (
                          <CapabilityConfigPanel
                            app={app}
                            capability={capability}
                            registered={registered}
                            onSave={saveCapabilityConfig}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>
                            当前没有从 App 读到这个能力。可以先取消选取，重新读取能力后再选择。
                          </Typography>
                        )}
                      </Box>
                    )
                  })}
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}
