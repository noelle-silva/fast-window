import { Avatar, Box, Chip, Switch, Typography } from '@mui/material'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import type { RegisteredApp, RegisteredAppCommand, RegisteredAppUpdatePatch } from '../apps/types'
import { isDataImageUrl } from '../utils'
import HostPageHeader from './HostPageHeader'
import { hostPageRootSx, hostPageScrollSx, hostSurfaceSx } from './hostUiStyles'
import { useHostAppearance } from './hostAppearance'

type CapabilityRegistryPageProps = {
  apps: RegisteredApp[]
  onBack: () => void
  onUpdate: (appId: string, patch: RegisteredAppUpdatePatch) => void | Promise<void>
}

type CapabilityEntry = {
  command: RegisteredAppCommand
  registered: boolean
}

function mergedCapabilities(app: RegisteredApp): CapabilityEntry[] {
  const selected = Array.isArray(app.commands) ? app.commands : []
  const available = Array.isArray(app.availableCommands) ? app.availableCommands : []
  const seen = new Set<string>()
  const entries: CapabilityEntry[] = []

  for (const command of selected) {
    const id = String(command.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    entries.push({ command, registered: true })
  }

  for (const command of available) {
    const id = String(command.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    entries.push({ command, registered: false })
  }

  return entries
}

function commandDescription(command: RegisteredAppCommand): string {
  const value = (command as { description?: unknown }).description
  return typeof value === 'string' ? value.trim() : ''
}

function iconSource(value: string | undefined): string | undefined {
  return value && isDataImageUrl(value) ? value : undefined
}

function iconText(value: string | undefined, fallback: string) {
  const raw = String(value || fallback || '').trim()
  return raw ? raw[0] : '?'
}

export default function CapabilityRegistryPage({ apps, onBack, onUpdate }: CapabilityRegistryPageProps) {
  const hostAppearance = useHostAppearance()
  const panelSx = hostSurfaceSx(hostAppearance.surfaceMode)
  const itemSx = hostSurfaceSx(hostAppearance.surfaceMode, { tone: 'item' })
  const appsWithCapabilities = apps
    .map(app => ({ app, capabilities: mergedCapabilities(app) }))
    .filter(item => item.capabilities.length > 0)
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
                  {capabilityCount > 0
                    ? `已发现 ${capabilityCount} 个能力，已选取 ${selectedCount} 个`
                    : '等待已注册 App 公告能力'}
                </Typography>
              </Box>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.7 }}>
              这里集中展示各个 App 已经对外公告的能力。打开开关后，该能力会加入主页搜索列表；关闭开关后，会从主页移除。
            </Typography>
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
                已注册的 App 暂未公告能力。启动对应 App 后，宿主会自动接收它们上报的能力清单。
              </Typography>
            </Box>
          ) : null}

          {appsWithCapabilities.map(({ app, capabilities }) => {
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

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {capabilities.map(({ command, registered }) => {
                    const commandIcon = iconSource(command.icon)
                    const description = commandDescription(command)
                    const toggleCapability = () => {
                      const currentCommands = Array.isArray(app.commands) ? app.commands : []
                      const nextCommands = registered
                        ? currentCommands.filter(item => item.id !== command.id)
                        : currentCommands.concat({ ...command })
                      void onUpdate(app.id, { commands: nextCommands })
                    }

                    return (
                      <Box
                        key={command.id}
                        sx={[
                          itemSx,
                          {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                          },
                        ]}
                      >
                        <Avatar
                          variant="rounded"
                          src={commandIcon}
                          sx={{ width: 30, height: 30, fontSize: 13, bgcolor: 'action.hover', color: 'text.primary', flexShrink: 0 }}
                        >
                          {commandIcon ? null : iconText(command.icon, command.title)}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                              {command.title}
                            </Typography>
                            <Chip
                              label={registered ? '已选取' : '可选取'}
                              size="small"
                              color={registered ? 'primary' : 'default'}
                              variant={registered ? 'filled' : 'outlined'}
                              sx={{ height: 18, fontSize: 10, borderRadius: 1 }}
                            />
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
                            {command.id}
                          </Typography>
                        </Box>
                        <Switch
                          size="small"
                          checked={registered}
                          onChange={toggleCapability}
                          inputProps={{ 'aria-label': `${registered ? '取消选取' : '选取'} ${command.title}` }}
                        />
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
