import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import RocketLaunchRoundedIcon from '@mui/icons-material/RocketLaunchRounded'
import { Box, Button, Chip, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { defaultModel } from '../../shared/aiOnceDomain'
import type { AiOnceController } from '../hooks/useAiOnceController'

type SpacesViewProps = {
  controller: AiOnceController
}

export function SpacesView(props: SpacesViewProps) {
  const { controller } = props
  const { data, history, phase } = controller.state

  if (!data) {
    return (
      <Box sx={{ minHeight: '55vh', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
        <Typography>{phase === 'failed' ? '后台启动失败，请检查设置或重试。' : 'AI Once 正在启动...'}</Typography>
      </Box>
    )
  }

  return (
    <Stack spacing={1.5}>
      <Paper sx={{ p: 1.5, borderRadius: 3, boxShadow: '0 12px 32px rgba(15, 23, 42, 0.07)' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>空间</Typography>
            <Typography variant="body2" color="text.secondary">用空间隔离不同的一次性 AI 场景，每个空间可维护自己的模板和默认模型。</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddRoundedIcon fontSize="small" />} onClick={controller.openCreateSpaceDialog} disabled={controller.state.busy}>
            新建空间
          </Button>
        </Stack>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
        {data.spaces.map((space, index) => {
          const count = history.filter(item => item.spaceId === space.id).length
          return (
            <Box key={space.id}>
              <Paper
                sx={{
                  height: '100%',
                  p: 1.5,
                  borderRadius: 3,
                  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.07)',
                  transition: 'transform .16s ease, box-shadow .16s ease',
                  '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 18px 44px rgba(37, 99, 235, 0.13)' },
                }}
              >
                <Stack spacing={1.25} sx={{ height: '100%' }}>
                  <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</Typography>
                      <Typography variant="caption" color="text.secondary">默认模型：{defaultModel(space, controller.providerId) || '未设置'}</Typography>
                    </Box>
                    <Chip size="small" color="primary" label={`${space.templates.length} 模板`} />
                  </Stack>

                  <Stack direction="row" spacing={0.75} flexWrap="wrap">
                    <Chip size="small" label={`${count} 条历史`} />
                    <Chip size="small" label={space.id === controller.state.spaceId ? '当前空间' : '可打开'} color={space.id === controller.state.spaceId ? 'success' : 'default'} />
                  </Stack>

                  <Box sx={{ flex: 1 }} />

                  <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                    <Button variant="contained" startIcon={<RocketLaunchRoundedIcon fontSize="small" />} onClick={() => controller.openSpace(space.id)}>
                      打开
                    </Button>
                    <Tooltip title="改名">
                      <IconButton aria-label={`改名 ${space.name}`} onClick={() => controller.openRenameSpace(space.id)}>
                        <EditRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="上移">
                      <span>
                        <IconButton aria-label={`上移 ${space.name}`} disabled={index === 0 || controller.state.busy} onClick={() => void controller.moveSpace(space.id, -1)}>
                          <ArrowUpwardRoundedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="下移">
                      <span>
                        <IconButton aria-label={`下移 ${space.name}`} disabled={index === data.spaces.length - 1 || controller.state.busy} onClick={() => void controller.moveSpace(space.id, 1)}>
                          <ArrowDownwardRoundedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="删除">
                      <span>
                        <IconButton color="error" aria-label={`删除 ${space.name}`} disabled={controller.state.busy} onClick={() => controller.requestDeleteSpace(space.id)}>
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Paper>
            </Box>
          )
        })}
      </Box>
    </Stack>
  )
}
