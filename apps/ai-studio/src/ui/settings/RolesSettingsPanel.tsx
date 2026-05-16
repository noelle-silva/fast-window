import * as React from 'react'
import { Avatar, Box, Button, Divider, Paper, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import type { AiChatController } from '../../controller/types'
import { formatModelRefDisplayText } from '../../domain/modelRefUtils'
import { SortHandleButton, SortModeButton } from '../components/SortControls'
import { SortableItem, SortableRoot, SortableSection, resolveSortMovePosition, type SortMovePosition } from '../components/SortableDnd'

type RolesSettingsPanelProps = {
  controller: AiChatController
  loading: boolean
  roles: any[]
  providers: any[]
  activeRoleId: string
  topbarHeight: number
}

export function RolesSettingsPanel(props: RolesSettingsPanelProps) {
  const { controller, loading, roles, providers, activeRoleId, topbarHeight } = props
  const [sortMode, setSortMode] = React.useState(false)

  const roleIds = React.useMemo(() => roles.map((role: any) => String(role?.id || '').trim()).filter(Boolean), [roles])

  const handleRoleMove = React.useCallback(
    (activeId: string, overId: string) => {
      const position = resolveSortMovePosition(roleIds, activeId, overId)
      if (!position) return
      controller.actions.moveRole?.(activeId, overId, position as SortMovePosition)
    },
    [controller, roleIds],
  )

  return (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', px: 2, pt: `calc(${topbarHeight}px + 16px)`, pb: 2, bgcolor: 'grey.50' }}>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 900 }}>角色管理</Typography>
          <Box sx={{ flex: 1 }} />
          <SortModeButton enabled={sortMode} onClick={() => setSortMode((value) => !value)} disabled={loading || roles.length <= 1} />
          <Button startIcon={<AddIcon />} onClick={() => controller.actions.createRole()} disabled={loading}>
            新建角色
          </Button>
        </Stack>
        <Divider sx={{ my: 1.5 }} />

        <SortableRoot onMove={handleRoleMove}>
          <SortableSection items={roleIds}>
            <Stack spacing={1.25}>
              {roles.length ? (
                roles.map((role: any) => {
                  const roleId = String(role?.id || '')
                  const isActive = !!roleId && roleId === activeRoleId
                  const modelRefText = formatModelRefDisplayText(role?.modelRef, providers)

                  return (
                    <SortableItem key={roleId} id={roleId} disabled={!sortMode}>
                      {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
                        <Paper
                          ref={setNodeRef}
                          variant="outlined"
                          sx={{
                            p: 1.25,
                            borderColor: isActive ? 'primary.main' : 'divider',
                            bgcolor: isActive ? 'rgba(25,118,210,.06)' : 'background.paper',
                            opacity: isDragging ? 0.5 : 1,
                          }}
                          style={style}
                        >
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                              <SortHandleButton
                                enabled={sortMode}
                                label={`拖拽排序 ${String(role?.name || '角色')}`}
                                handleRef={setHandleRef}
                                handleProps={handleProps}
                                isDragging={isDragging}
                                sx={{ ml: -0.5 }}
                              />
                              <Avatar src={String(role?.avatarImage || '') || undefined} sx={{ width: 28, height: 28, fontSize: 14 }}>
                                {String(role?.avatar || '🙂')}
                              </Avatar>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 900 }} noWrap>
                                  {String(role?.name || '')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {modelRefText || '未配置模型'}
                                </Typography>
                              </Box>
                            </Stack>

                            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <Button size="small" variant={isActive ? 'contained' : 'outlined'} onClick={() => controller.actions.setActiveRole(roleId)} disabled={!roleId}>
                                {isActive ? '当前' : '设为当前'}
                              </Button>
                              <Button size="small" onClick={() => controller.actions.openRoleEditor(roleId)} disabled={!roleId}>
                                编辑
                              </Button>
                              <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteRole(roleId)} disabled={!roleId}>
                                删除
                              </Button>
                            </Stack>
                          </Stack>
                        </Paper>
                      )}
                    </SortableItem>
                  )
                })
              ) : (
                <Typography variant="body2" color="text.secondary">
                  暂无角色
                </Typography>
              )}
            </Stack>
          </SortableSection>
        </SortableRoot>
      </Paper>
    </Box>
  )
}
