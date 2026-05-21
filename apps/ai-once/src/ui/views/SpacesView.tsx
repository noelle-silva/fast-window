import * as React from 'react'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { Box, Paper, Stack, Typography } from '@mui/material'
import { defaultModel, modelCoordinate } from '../../shared/aiOnceDomain'
import type { AiOnceController } from '../hooks/useAiOnceController'
import { SortableItem, SortableRoot, SortableSection, rectSortingStrategy, resolveSortMovePosition } from '../components/SortableDnd'

type SpacesViewProps = {
  controller: AiOnceController
}

export function SpacesView(props: SpacesViewProps) {
  const { controller } = props
  const { data, phase } = controller.state
  const sortMode = controller.state.spacesSortMode
  const spaceIds = React.useMemo(() => data?.spaces.map(space => space.id) || [], [data?.spaces])

  const handleSpaceMove = React.useCallback(
    (activeId: string, overId: string) => {
      const position = resolveSortMovePosition(spaceIds, activeId, overId)
      if (!position) return
      void controller.moveSpace(activeId, overId, position)
    },
    [controller, spaceIds],
  )

  if (!data) {
    return (
      <Box sx={{ minHeight: '55vh', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
        <Typography>{phase === 'failed' ? '后台启动失败，请检查设置或重试。' : 'AI Once 正在启动...'}</Typography>
      </Box>
    )
  }

  return (
    <SortableRoot onMove={handleSpaceMove}>
      <SortableSection items={spaceIds} strategy={rectSortingStrategy}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
          {data.spaces.map(space => {
            const defaultModelCoordinate = modelCoordinate(controller.provider?.name || '', defaultModel(space, controller.providerId))
            const itemDisabled = !sortMode || controller.state.busy || controller.state.asking
            return (
              <SortableItem key={space.id} id={space.id} disabled={itemDisabled}>
                {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
                  <Box ref={setNodeRef} style={style} sx={{ minWidth: 0 }}>
                    <Paper
                      ref={sortMode ? setHandleRef : undefined}
                      role="button"
                      tabIndex={0}
                      onClick={!sortMode ? () => controller.openSpace(space.id) : undefined}
                      onKeyDown={!sortMode
                        ? event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              controller.openSpace(space.id)
                            }
                          }
                        : undefined}
                      {...(sortMode ? handleProps : {})}
                      aria-label={sortMode ? `拖拽排序 ${space.name}` : `打开空间 ${space.name}`}
                      sx={{
                        height: '100%',
                        p: 1.5,
                        borderRadius: 3,
                        boxShadow: isDragging ? '0 24px 60px rgba(37, 99, 235, 0.22)' : '0 12px 32px rgba(15, 23, 42, 0.07)',
                        cursor: sortMode ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                        opacity: isDragging ? 0.72 : 1,
                        outline: sortMode ? '1px dashed rgba(37, 99, 235, 0.28)' : '1px solid transparent',
                        touchAction: sortMode ? 'none' : 'auto',
                        transition: 'transform .16s ease, box-shadow .16s ease, outline-color .16s ease',
                        '&:hover': sortMode
                          ? { boxShadow: '0 18px 44px rgba(37, 99, 235, 0.13)' }
                          : { transform: 'translateY(-1px)', boxShadow: '0 18px 44px rgba(37, 99, 235, 0.13)' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                      }}
                    >
                      <Stack spacing={1.25} sx={{ height: '100%' }}>
                        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</Typography>
                            <Typography variant="caption" color="text.secondary">默认模型：{defaultModelCoordinate || '未设置'}</Typography>
                          </Box>
                          {!sortMode ? (
                            <ArrowForwardRoundedIcon fontSize="small" color="action" />
                          ) : null}
                        </Stack>

                        <Box sx={{ flex: 1 }} />
                      </Stack>
                    </Paper>
                  </Box>
                )}
              </SortableItem>
            )
          })}
        </Box>
      </SortableSection>
    </SortableRoot>
  )
}
