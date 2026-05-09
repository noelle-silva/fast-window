import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { Box, Paper, Stack, Typography } from '@mui/material'
import { defaultModel, modelCoordinate } from '../../shared/aiOnceDomain'
import type { AiOnceController } from '../hooks/useAiOnceController'

type SpacesViewProps = {
  controller: AiOnceController
}

export function SpacesView(props: SpacesViewProps) {
  const { controller } = props
  const { data, phase } = controller.state

  if (!data) {
    return (
      <Box sx={{ minHeight: '55vh', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
        <Typography>{phase === 'failed' ? '后台启动失败，请检查设置或重试。' : 'AI Once 正在启动...'}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
      {data.spaces.map(space => {
        const defaultModelCoordinate = modelCoordinate(controller.provider?.name || '', defaultModel(space, controller.providerId))
        return (
          <Box key={space.id}>
            <Paper
              role="button"
              tabIndex={0}
              aria-label={`打开空间 ${space.name}`}
              onClick={() => controller.openSpace(space.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  controller.openSpace(space.id)
                }
              }}
              sx={{
                height: '100%',
                p: 1.5,
                borderRadius: 3,
                boxShadow: '0 12px 32px rgba(15, 23, 42, 0.07)',
                cursor: 'pointer',
                transition: 'transform .16s ease, box-shadow .16s ease',
                '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 18px 44px rgba(37, 99, 235, 0.13)' },
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
              }}
            >
              <Stack spacing={1.25} sx={{ height: '100%' }}>
                <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</Typography>
                    <Typography variant="caption" color="text.secondary">默认模型：{defaultModelCoordinate || '未设置'}</Typography>
                  </Box>
                  <ArrowForwardRoundedIcon fontSize="small" color="action" />
                </Stack>

                <Box sx={{ flex: 1 }} />
              </Stack>
            </Paper>
          </Box>
        )
      })}
    </Box>
  )
}
