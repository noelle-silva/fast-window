import { Box, Stack, Typography } from '@mui/material'
import type { AppStatus, RegisteredApp } from '../apps/types'

type AppCatalogListProps = {
  apps: RegisteredApp[]
  statuses: Record<string, AppStatus>
  onPick: (appId: string) => void
}

export default function AppCatalogList({ apps, statuses, onPick }: AppCatalogListProps) {
  const runningCount = apps.filter(app => statuses[app.id]?.running).length

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mb: 0.75 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          已注册应用
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {runningCount} 个在运行 / 共 {apps.length} 个 · 点击填入停止命令
        </Typography>
      </Stack>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {apps.map(app => {
          const running = statuses[app.id]?.running === true
          return (
            <Stack
              key={app.id}
              direction="row"
              spacing={0.5}
              onClick={() => onPick(app.id)}
              sx={{
                alignItems: 'center',
                px: 1,
                py: 0.4,
                borderRadius: 999,
                cursor: 'pointer',
                bgcolor: running ? 'success.main' : 'action.hover',
                '&:hover': { bgcolor: running ? 'success.dark' : 'action.selected' },
              }}
            >
              <Box
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: running ? 'success.contrastText' : 'text.disabled',
                }}
              />
              <Typography variant="caption" sx={{ color: running ? 'success.contrastText' : 'text.secondary' }}>
                {app.name}
              </Typography>
            </Stack>
          )
        })}
        {apps.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            注册表为空。
          </Typography>
        ) : null}
      </Box>
    </Box>
  )
}
