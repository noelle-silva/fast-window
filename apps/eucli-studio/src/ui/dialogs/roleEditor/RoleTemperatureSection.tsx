import * as React from 'react'
import { Box, Slider, Stack, Switch, Typography } from '@mui/material'
import { RoleEditorSection } from './RoleEditorLayout'

/** 温度：关闭后请求不带 temperature，走模型默认值。 */
export function RoleTemperatureSection(props: { controller: any; draft: any }) {
  const { controller, draft } = props
  const temperatureEnabled = draft?.roleTemperatureEnabled === true
  const rawTemperature = Number(draft?.roleTemperature || 1)
  const temperature = Number.isFinite(rawTemperature) ? rawTemperature : 1

  return (
    <RoleEditorSection title="温度">
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 900 }}>
            启用温度
          </Typography>
          <Typography variant="caption" color="text.secondary">
            关闭后不发送温度，走模型默认。
          </Typography>
        </Box>
        <Switch
          checked={temperatureEnabled}
          onChange={(event) => controller.actions.setDraft('roleTemperatureEnabled', event.target.checked)}
        />
      </Stack>
      <Typography variant="body2" sx={{ fontWeight: 900, opacity: temperatureEnabled ? 1 : 0.4 }}>
        温度：{temperature.toFixed(2)}
      </Typography>
      <Slider
        disabled={!temperatureEnabled}
        value={temperature}
        min={0}
        max={2}
        step={0.05}
        onChange={(_event, next) => controller.actions.setDraft('roleTemperature', String(next))}
      />
    </RoleEditorSection>
  )
}
