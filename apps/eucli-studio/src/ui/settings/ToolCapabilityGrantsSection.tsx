import * as React from 'react'
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { SettingsListItem, SettingsPill, SettingsSection } from './SettingsSurfaces'

type ToolCapabilityGrantsSectionProps = {
  controller: any
  tool: any
  tools: any
}

// capabilityAccessLabel 把能力访问方式翻译为界面标签。
function capabilityAccessLabel(access: any) {
  switch (String(access || '').trim()) {
    case 'write':
      return '写入'
    case 'reference':
      return '引用'
    default:
      return '读取'
  }
}

// ToolCapabilityGrantsSection 按工具的能力声明渲染授权开关：
// 只渲染需要用户授权的能力（宿主主动提供的注入类能力不出现在此处），
// 读取、写入与引用分别授权，界面不含任何工具名判断。
export function ToolCapabilityGrantsSection(props: ToolCapabilityGrantsSectionProps) {
  const { controller, tool, tools } = props
  const capabilities = (Array.isArray(tool?.capabilities) ? tool.capabilities : []).filter((capability: any) => capability?.grantRequired === true)
  if (!capabilities.length) return null
  const grants = tools?.capabilityGrantsDraft && typeof tools.capabilityGrantsDraft === 'object' ? tools.capabilityGrantsDraft : {}
  return (
    <SettingsSection>
      <Stack spacing={1.25}>
        <Typography sx={{ fontWeight: 900 }}>能力授权</Typography>
        <Typography variant="caption" color="text.secondary">工具声明使用以下能力；只有开启授权后，宿主才会为它提供对应服务。</Typography>
        <Stack spacing={0.75}>
          {capabilities.map((capability: any) => {
            const key = `${String(capability.id || '').trim()}:${String(capability.access || '').trim()}`
            if (!key || key === ':') return null
            const checked = grants[key] === true
            return (
              <SettingsListItem key={key} sx={{ p: 1, bgcolor: 'background.paper' }}>
                <FormControlLabel
                  sx={{ m: 0, width: '100%' }}
                  control={<Switch size="small" checked={checked} onChange={(event) => controller.actions.setToolCapabilityGrant?.(key, event.target.checked)} />}
                  label={
                    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ fontWeight: 900 }}>{String(capability.name || capability.id || '')}</Typography>
                        <SettingsPill>{capabilityAccessLabel(capability.access)}</SettingsPill>
                      </Stack>
                      {capability.description ? <Typography variant="caption" color="text.secondary">{String(capability.description)}</Typography> : null}
                    </Stack>
                  }
                />
              </SettingsListItem>
            )
          })}
        </Stack>
      </Stack>
    </SettingsSection>
  )
}
