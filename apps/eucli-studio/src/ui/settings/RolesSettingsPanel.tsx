import * as React from 'react'
import { Avatar, Box, Button, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SaveIcon from '@mui/icons-material/Save'
import type { AiChatController } from '../../controller/types'
import { NEW_ROLE_ID } from '../../domain/constants'
import { formatModelRefDisplayText } from '../../domain/modelRefUtils'
import { SortHandleButton, SortModeButton } from '../components/SortControls'
import { SortableItem, SortableRoot, SortableSection, resolveSortMovePosition, type SortMovePosition } from '../components/SortableDnd'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { RoleEditorForm } from '../dialogs/RoleEditorForm'
import { SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type RolesSettingsPanelProps = {
  controller: AiChatController
  loading: boolean
  roles: any[]
  providers: any[]
  modelGroups: any[]
  models: any
  tools: any
  hookPrompts: any
  draft: any
  activeRoleId: string
}

export function RolesSettingsPanel(props: RolesSettingsPanelProps) {
  const { controller, loading, roles, providers, modelGroups, models, tools, hookPrompts, draft, activeRoleId } = props
  const [sortMode, setSortMode] = React.useState(false)

  const roleIds = React.useMemo(() => roles.map((role: any) => String(role?.id || '').trim()).filter(Boolean), [roles])
  const editingRoleId = String(draft?.editRoleId || '')
  const editorInPlace = draft?.roleEditorInPlace === true
  const editingRole = editorInPlace ? roles.find((role: any) => String(role?.id || '') === editingRoleId) || null : null
  const editingNewRole = editorInPlace && editingRoleId === NEW_ROLE_ID
  const editorOpen = editorInPlace && (!!editingRole || editingNewRole)
  const editingIsActive = !!editingRoleId && editingRoleId === activeRoleId
  const avatarCropSrc = String(draft?.roleAvatarImageCropSrc || '').trim()

  const handleRoleMove = React.useCallback(
    (activeId: string, overId: string) => {
      const position = resolveSortMovePosition(roleIds, activeId, overId)
      if (!position) return
      controller.actions.moveRole?.(activeId, overId, position as SortMovePosition)
    },
    [controller, roleIds],
  )

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900 }}>角色管理</Typography>
            <Typography variant="caption" color="text.secondary">编辑角色信息、系统提示词、模型与工具白名单。</Typography>
          </Box>
          <SortModeButton enabled={sortMode} onClick={() => setSortMode((value) => !value)} disabled={loading || roles.length <= 1} />
          <Button startIcon={<AddIcon />} variant="text" onClick={() => controller.actions.createRoleInPlace?.()} disabled={loading}>
            新建角色
          </Button>
          <Button startIcon={<SaveIcon />} variant="contained" onClick={() => controller.actions.saveRole?.()} disabled={loading || !editorOpen || !!avatarCropSrc}>
            保存
          </Button>
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 260, lg: 300 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>角色列表</Typography>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <SortableRoot onMove={handleRoleMove}>
                  <SortableSection items={roleIds}>
                    <Stack spacing={1}>
                      {roles.length ? roles.map((role: any) => {
                        const roleId = String(role?.id || '')
                        const selected = !!roleId && roleId === editingRoleId && editorInPlace
                        const isActive = !!roleId && roleId === activeRoleId
                        const modelRefText = formatModelRefDisplayText(role?.modelRef, providers, modelGroups)
                        return (
                          <SortableItem key={roleId} id={roleId} disabled={!sortMode}>
                            {({ setNodeRef, setHandleRef, handleProps, isDragging, style }) => (
                              <Box ref={setNodeRef} style={style} sx={{ display: 'flex', alignItems: 'center', gap: 0.25, opacity: isDragging ? 0.5 : 1 }}>
                                <SortHandleButton
                                  enabled={sortMode}
                                  label={`拖拽排序 ${String(role?.name || '角色')}`}
                                  handleRef={setHandleRef}
                                  handleProps={handleProps}
                                  isDragging={isDragging}
                                  sx={{ ml: -0.5 }}
                                />
                                <Button
                                  variant={selected ? 'contained' : 'text'}
                                  color={selected ? 'primary' : 'inherit'}
                                  onClick={() => controller.actions.openRoleEditorInPlace?.(roleId)}
                                  disabled={!roleId}
                                  sx={{ justifyContent: 'flex-start', minWidth: 0, flex: 1, px: 1, textTransform: 'none', textAlign: 'left' }}
                                >
                                  <Avatar src={String(role?.avatarImage || '') || undefined} sx={{ width: 24, height: 24, fontSize: 12, mr: 0.75 }}>
                                    {String(role?.avatar || '🙂')}
                                  </Avatar>
                                  <Box sx={{ minWidth: 0 }}>
                                    <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 800 }}>
                                      {String(role?.name || '')}{isActive ? ' · 当前' : ''}
                                    </Box>
                                    <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'text.secondary' }}>
                                      {modelRefText || '未配置模型'}
                                    </Box>
                                  </Box>
                                </Button>
                              </Box>
                            )}
                          </SortableItem>
                        )
                      }) : <Typography variant="body2" color="text.secondary">暂无角色。</Typography>}
                    </Stack>
                  </SortableSection>
                </SortableRoot>
              </Box>
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }}>
              {editorOpen ? (
                <Stack spacing={1.5}>
                  <SettingsSection>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>{editingRole ? '角色编辑' : '新建角色'}</Typography>
                      {editingIsActive ? <SettingsPill tone="selected">当前角色</SettingsPill> : null}
                      <Box sx={{ flex: 1 }} />
                      {editingRole ? (
                        <>
                          <Button size="small" variant="outlined" onClick={() => controller.actions.setActiveRole?.(editingRoleId)} disabled={editingIsActive}>
                            设为当前
                          </Button>
                          <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteRole?.(editingRoleId)}>
                            删除角色
                          </Button>
                        </>
                      ) : null}
                    </Stack>
                  </SettingsSection>

                  <RoleEditorForm controller={controller} providers={providers} modelGroups={modelGroups} draft={draft} models={models} tools={tools} hookPrompts={hookPrompts} />
                </Stack>
              ) : (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">选择一个角色查看和编辑。</Typography>
                </SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>
      </Stack>
    </SettingsSurface>
  )
}
