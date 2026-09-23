import { Box, Button, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SaveIcon from '@mui/icons-material/Save'
import { NEW_GROUP_ID } from '../../domain/constants'
import { GroupEditorForm } from '../dialogs/GroupEditorForm'
import { EntityAvatar } from '../components/avatar/EntityAvatar'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { MoreActionsMenu } from '../components/MoreActionsMenu'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { SettingsHeading, SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type GroupsSettingsPanelProps = {
  controller: any
  loading: boolean
  groups: any[]
  roles: any[]
  draft: any
  activeGroupId: string
  activeTargetKind: string
}

export function GroupsSettingsPanel(props: GroupsSettingsPanelProps) {
  const { controller, loading, groups, roles, draft, activeGroupId, activeTargetKind } = props

  const editingGroupId = String((draft as any)?.editGroupId || '')
  const editorInPlace = (draft as any)?.groupEditorInPlace === true
  const editingGroup = editorInPlace ? groups.find((group: any) => String(group?.id || '') === editingGroupId) || null : null
  const editingNewGroup = editorInPlace && editingGroupId === NEW_GROUP_ID
  const editorOpen = editorInPlace && (!!editingGroup || editingNewGroup)
  const editingIsActive = !!editingGroupId && activeTargetKind === 'group' && editingGroupId === activeGroupId

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <SettingsHeading title="群组管理" description="维护群组成员、轮流顺序与随机参数。" />
          <Button startIcon={<AddIcon />} variant="text" onClick={() => controller.actions.createGroupInPlace?.()} disabled={loading}>
            新建群组
          </Button>
          <Button startIcon={<SaveIcon />} variant="contained" onClick={() => controller.actions.saveGroup?.()} disabled={loading || !editorOpen}>
            保存
          </Button>
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 260, lg: 300 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>群组列表</Typography>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <Stack spacing={1}>
                  {groups.length ? groups.map((group: any) => {
                    const groupId = String(group?.id || '')
                    const selected = !!groupId && groupId === editingGroupId && editorInPlace
                    const isActive = !!groupId && activeTargetKind === 'group' && groupId === activeGroupId
                    const memberCount = Array.isArray(group?.memberRoleIds) ? group.memberRoleIds.length : 0
                    return (
                      <Button
                        key={groupId}
                        variant={selected ? 'contained' : 'text'}
                        color={selected ? 'primary' : 'inherit'}
                        onClick={() => controller.actions.openGroupEditorInPlace?.(groupId)}
                        disabled={!groupId}
                        sx={{ justifyContent: 'flex-start', minWidth: 0, width: '100%', px: 1, textTransform: 'none', textAlign: 'left' }}
                      >
                        <EntityAvatar kind="group" image={String(group?.avatarImage || '')} size={24} sx={{ mr: 0.75 }} />
                        <Box sx={{ minWidth: 0 }}>
                          <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 800 }}>
                            {String(group?.name || '未命名群组')}{isActive ? ' · 当前' : ''}
                          </Box>
                          <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'text.secondary' }}>
                            {memberCount ? `${memberCount} 个成员` : '未选择成员'}
                          </Box>
                        </Box>
                      </Button>
                    )
                  }) : <Typography variant="body2" color="text.secondary">暂无群组。</Typography>}
                </Stack>
              </Box>
            </Stack>
          </SettingsSection>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <CustomScrollArea hostSx={{ height: '100%', minHeight: 0 }} scrollSx={{ height: '100%' }}>
              {editorOpen ? (
                <Stack spacing={1.5}>
                  <SettingsSection>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>{editingGroup ? '群组编辑' : '新建群组'}</Typography>
                      {editingIsActive ? <SettingsPill tone="selected">当前群组</SettingsPill> : null}
                      <Box sx={{ flex: 1 }} />
                      {editingGroup ? (
                        <>
                          <Button size="small" variant="outlined" onClick={() => controller.actions.setActiveGroup?.(editingGroupId)} disabled={editingIsActive}>
                            进入群聊
                          </Button>
                          <MoreActionsMenu
                            items={[{
                              key: 'delete',
                              label: '删除群组',
                              icon: <DeleteOutlineIcon fontSize="small" />,
                              danger: true,
                              onSelect: () => controller.actions.askDeleteGroup?.(editingGroupId),
                            }]}
                          />
                        </>
                      ) : null}
                    </Stack>
                  </SettingsSection>

                  <GroupEditorForm controller={controller} roles={roles} draft={draft} />
                </Stack>
              ) : (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">选择一个群组查看和编辑。</Typography>
                </SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>
      </Stack>
    </SettingsSurface>
  )
}
