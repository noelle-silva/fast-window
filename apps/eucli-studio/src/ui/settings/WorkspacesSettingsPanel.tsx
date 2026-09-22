import { Box, Button, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import SaveIcon from '@mui/icons-material/Save'
import { NEW_WORKSPACE_ID } from '../../domain/constants'
import { WorkspaceEditorForm } from '../dialogs/WorkspaceEditorForm'
import { CustomScrollArea } from '../components/CustomScrollArea'
import { customScrollbarHiddenSx } from '../scroll/customScrollbars'
import { SettingsPill, SettingsSection, SettingsSurface } from './SettingsSurfaces'

type WorkspacesSettingsPanelProps = {
  controller: any
  loading: boolean
  workspaces: any[]
  draft: any
  activeWorkspaceId: string
  activeTargetKind: string
}

export function WorkspacesSettingsPanel(props: WorkspacesSettingsPanelProps) {
  const { controller, loading, workspaces, draft, activeWorkspaceId, activeTargetKind } = props

  const editingWorkspaceId = String((draft as any)?.editWorkspaceId || '')
  const editorInPlace = (draft as any)?.workspaceEditorInPlace === true
  const editingWorkspace = editorInPlace ? workspaces.find((workspace: any) => String(workspace?.id || '') === editingWorkspaceId) || null : null
  const editingNewWorkspace = editorInPlace && editingWorkspaceId === NEW_WORKSPACE_ID
  const editorOpen = editorInPlace && (!!editingWorkspace || editingNewWorkspace)
  const editingIsActive = !!editingWorkspaceId && activeTargetKind === 'workspace' && editingWorkspaceId === activeWorkspaceId

  return (
    <SettingsSurface sx={{ height: '100%' }}>
      <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 900 }}>工作区管理</Typography>
            <Typography variant="caption" color="text.secondary">维护工作区提示词与目录清单。</Typography>
          </Box>
          <Button startIcon={<AddIcon />} variant="text" onClick={() => controller.actions.createWorkspaceInPlace?.()} disabled={loading}>
            新建工作区
          </Button>
          <Button startIcon={<SaveIcon />} variant="contained" onClick={() => controller.actions.saveWorkspace?.()} disabled={loading || !editorOpen}>
            保存
          </Button>
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <SettingsSection tone="muted" sx={{ p: 1, width: { xs: 200, sm: 260, lg: 300 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Stack spacing={1} sx={{ flex: 1, minHeight: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }}>工作区列表</Typography>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', ...customScrollbarHiddenSx }}>
                <Stack spacing={1}>
                  {workspaces.length ? workspaces.map((workspace: any) => {
                    const workspaceId = String(workspace?.id || '')
                    const selected = !!workspaceId && workspaceId === editingWorkspaceId && editorInPlace
                    const isActive = !!workspaceId && activeTargetKind === 'workspace' && workspaceId === activeWorkspaceId
                    const directories = Array.isArray(workspace?.directories) ? workspace.directories : []
                    return (
                      <Button
                        key={workspaceId}
                        variant={selected ? 'contained' : 'text'}
                        color={selected ? 'primary' : 'inherit'}
                        onClick={() => controller.actions.openWorkspaceEditorInPlace?.(workspaceId)}
                        disabled={!workspaceId}
                        sx={{ justifyContent: 'flex-start', minWidth: 0, width: '100%', px: 1, textTransform: 'none', textAlign: 'left' }}
                      >
                        <Box sx={{ width: 24, height: 24, borderRadius: 1.5, bgcolor: 'rgba(59,130,246,.10)', color: 'primary.main', display: 'grid', placeItems: 'center', flexShrink: 0, mr: 0.75 }}>
                          <FolderOutlinedIcon sx={{ fontSize: 16 }} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 800 }}>
                            {String(workspace?.name || '未命名工作区')}{isActive ? ' · 当前' : ''}
                          </Box>
                          <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'text.secondary' }}>
                            {directories.length ? `${directories.length} 个目录` : '暂未登记目录'}
                          </Box>
                        </Box>
                      </Button>
                    )
                  }) : <Typography variant="body2" color="text.secondary">暂无工作区。</Typography>}
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
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>{editingWorkspace ? '工作区编辑' : '新建工作区'}</Typography>
                      {editingIsActive ? <SettingsPill tone="selected">当前工作区</SettingsPill> : null}
                      <Box sx={{ flex: 1 }} />
                      {editingWorkspace ? (
                        <>
                          <Button size="small" variant="outlined" onClick={() => controller.actions.setActiveWorkspace?.(editingWorkspaceId)} disabled={editingIsActive}>
                            进入工作区
                          </Button>
                          <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => controller.actions.askDeleteWorkspace?.(editingWorkspaceId)}>
                            删除工作区
                          </Button>
                        </>
                      ) : null}
                    </Stack>
                  </SettingsSection>

                  <WorkspaceEditorForm controller={controller} draft={draft} />
                </Stack>
              ) : (
                <SettingsSection sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">选择一个工作区查看和编辑。</Typography>
                </SettingsSection>
              )}
            </CustomScrollArea>
          </Box>
        </Stack>
      </Stack>
    </SettingsSurface>
  )
}
