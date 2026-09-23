import { Box, Stack, Typography } from '@mui/material'
import CableIcon from '@mui/icons-material/Cable'
import { compatibilityRangeText, type StudioBootstrap } from '../../domain/release'
import { SettingsHeading, SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type EbSettingsPanelProps = {
  bootstrap?: StudioBootstrap
}

export function EbSettingsPanel(props: EbSettingsPanelProps) {
  const { bootstrap } = props

  return (
    <SettingsSurface>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
          <Box sx={{ width: 42, height: 42, borderRadius: 2, bgcolor: 'rgba(14,165,233,.10)', color: 'info.main', display: 'grid', placeItems: 'center' }}>
            <CableIcon fontSize="small" />
          </Box>
          <SettingsHeading title="eucli-box连接设置" description="查看客户端与 eucli-box 的版本和适用情况。" descriptionVariant="body2" />
        </Stack>

        {bootstrap ? (
          <SettingsSection tone="muted">
            <Stack spacing={1}>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 900 }}>版本与连接</Typography>
                <SettingsPill tone={bootstrap.businessAvailable ? 'selected' : 'danger'}>
                  {bootstrap.businessAvailable ? '适用' : '不可用'}
                </SettingsPill>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ flexWrap: 'wrap' }}>
                <ReleaseFact label="客户端版本" value={bootstrap.clientVersion || '版本资料无效'} />
                <ReleaseFact label="eucli-box 版本" value={bootstrap.eucliBoxVersion || '版本资料无效'} />
                <ReleaseFact label="客户端所需范围" value={compatibilityRangeText(bootstrap.clientEucliBoxCompatibility)} />
              </Stack>
              {bootstrap.eucliBoxIssue ? (
                <Typography variant="caption" color="error">{bootstrap.eucliBoxIssue}</Typography>
              ) : null}
            </Stack>
          </SettingsSection>
        ) : null}
      </Stack>
    </SettingsSurface>
  )
}

function ReleaseFact(props: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: { xs: 0, sm: 180 }, flex: '1 1 180px' }}>
      <Typography variant="caption" color="text.secondary">{props.label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{props.value}</Typography>
    </Box>
  )
}
